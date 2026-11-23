const crypto = require('crypto');
const config = require('../config');
const {
  getDb,
  normalizeUserJid,
  normalizeMinecraftUsername,
  getSetting,
  setSetting,
  addAuditLog,
} = require('./database');
const { getEconomy, addBalance, deductBalance } = require('./economy');
const { fetchMinecraftServerStatus } = require('./api');
const {
  formatSafeMcTarget,
  executeMinecraftCommand,
  sendMinecraftBridgeChat,
  whisperMinecraftPlayer,
  startPteroConsoleStream,
  stopPteroConsoleStream,
  getPteroStreamState,
} = require('./ptero');
const {
  setDiscordBridgeListeners,
  sendDiscordBridgeMessage,
  sendDiscordStatusNotification,
} = require('./discord');
const {
  smallcaps,
  renderBox,
  formatSuccess,
  keep,
  mono,
} = require('./smallcaps');
const { getWibDateKey, formatNumber, logger } = require('./logger');

// =====================================================================
// STATE EPHEMERAL DI MEMORI (TIDAK MENYIMPAN ISI CHAT KE DATABASE!)
// =====================================================================

let activeWaSock = null;
let statusPollTimer = null;
let lastPolledOnline = null;

// Anti-flood bridge: key -> array timestamp pesan
const bridgeFloodMap = new Map();
// Pelacak waktu sesi bermain untuk hitung playtime_minutes otomatis: mc_normalized -> joinTimestamp
const onlinePlaytimeSessions = new Map();
// Debounce notifikasi join/leave agar tidak spam saat sinyal pemain putus-nyambung: key -> timestamp
const joinLeaveDebounce = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, list] of bridgeFloodMap.entries()) {
    const filtered = list.filter(
      (t) => now - t < (config.bridge?.rateLimitWindowMs || 6000)
    );
    if (filtered.length === 0) bridgeFloodMap.delete(k);
    else bridgeFloodMap.set(k, filtered);
  }
  for (const [k, ts] of joinLeaveDebounce.entries()) {
    if (now - ts > 15000) joinLeaveDebounce.delete(k);
  }
}, 60 * 1000).unref();

// =====================================================================
// 1. PENGATURAN GRUP BRIDGE WA & PEMBERITAHUAN PRIVASI WAJIB
// =====================================================================

function getEnabledBridgeGroups() {
  const groupSet = new Set(config.bridge?.waGroupJids || []);
  try {
    const raw = getSetting('bridge_wa_groups', '[]');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const g of parsed) {
        if (typeof g === 'string' && g.endsWith('@g.us')) {
          groupSet.add(g);
        }
      }
    }
  } catch {
    // Gunakan nilai default dari config
  }
  // Hapus grup yang sengaja dimatikan secara eksplisit via .bridge off
  try {
    const disabledRaw = getSetting('bridge_disabled_groups', '[]');
    const disabledList = JSON.parse(disabledRaw);
    if (Array.isArray(disabledList)) {
      for (const g of disabledList) {
        groupSet.delete(g);
      }
    }
  } catch {
    // Abaikan
  }
  return Array.from(groupSet);
}

function isWaGroupBridged(groupJid) {
  if (!groupJid || !groupJid.endsWith('@g.us')) return false;
  return getEnabledBridgeGroups().includes(groupJid);
}

function setWaGroupBridgeState(groupJid, enabled) {
  if (!groupJid || !groupJid.endsWith('@g.us')) return false;

  let saved = [];
  let disabled = [];
  try {
    saved = JSON.parse(getSetting('bridge_wa_groups', '[]')) || [];
  } catch {
    saved = [];
  }
  try {
    disabled = JSON.parse(getSetting('bridge_disabled_groups', '[]')) || [];
  } catch {
    disabled = [];
  }

  const savedSet = new Set(Array.isArray(saved) ? saved : []);
  const disabledSet = new Set(Array.isArray(disabled) ? disabled : []);

  if (enabled) {
    savedSet.add(groupJid);
    disabledSet.delete(groupJid);
  } else {
    savedSet.delete(groupJid);
    disabledSet.add(groupJid);
  }

  setSetting('bridge_wa_groups', JSON.stringify(Array.from(savedSet)));
  setSetting('bridge_disabled_groups', JSON.stringify(Array.from(disabledSet)));
  return true;
}

function isJoinLeaveNotifyEnabled() {
  const val = getSetting(
    'bridge_notify_join_leave',
    config.bridge?.notifyJoinLeave ? 'true' : 'false'
  );
  return val === 'true';
}

function isServerStatusNotifyEnabled() {
  const val = getSetting(
    'bridge_notify_status',
    config.bridge?.notifyStatus ? 'true' : 'false'
  );
  return val === 'true';
}

/**
 * Teks Pemberitahuan Privasi Wajib saat grup dijadikan jembatan 2 arah
 */
function buildBridgePrivacyNotice() {
  const p = config.prefix || '.';
  return renderBox(
    '✿ ᴘᴇᴍʙᴇʀɪᴛᴀʜᴜᴀɴ ᴘʀɪᴠᴀsɪ ʙʀɪᴅɢᴇ',
    [
      `✦ Grup ini terhubung ke Jembatan Komunitas 2 Arah ${keep(config.botName)} ♡`,
      '✦ Pesan teks biasa di grup ini diteruskan secara langsung (real-time) ke chat Server Minecraft & Channel Discord resmi.',
      `✦ Command yang diawali ${mono(p)} tidak ikut diteruskan ke luar grup.`,
      '✦ Demi privasi bersama, bot TIDAK menyimpan isi percakapan bridge ke dalam database.',
      '◦ Harap jaga sopan santun & jangan bagikan data rahasia/pribadi di chat publik ya ♡',
    ],
    { footer: config.footer }
  );
}

/**
 * Cek anti-flood untuk mencegah spam lintas platform
 */
function allowBridgeThroughput(senderKey) {
  const now = Date.now();
  const winMs = Number(config.bridge?.rateLimitWindowMs || 6000);
  const maxMsg = Number(config.bridge?.rateLimitMax || 4);
  const prev = (bridgeFloodMap.get(senderKey) || []).filter((t) => now - t < winMs);
  if (prev.length >= maxMsg) {
    bridgeFloodMap.set(senderKey, prev);
    return false;
  }
  prev.push(now);
  bridgeFloodMap.set(senderKey, prev);
  return true;
}

/**
 * Kirim teks ke seluruh grup WhatsApp yang mengaktifkan Bridge
 */
async function broadcastToBridgedWaGroups(formattedText) {
  const groups = getEnabledBridgeGroups();
  if (groups.length === 0) {
    return { sent: 0, dryRun: config.dryRun };
  }
  if (config.dryRun) {
    return { sent: groups.length, dryRun: true };
  }
  if (!activeWaSock) {
    return { sent: 0, error: 'Socket WA belum siap' };
  }

  let sent = 0;
  for (const gJid of groups) {
    try {
      await activeWaSock.sendMessage(gJid, { text: formattedText });
      sent += 1;
    } catch (err) {
      logger.warn('BRIDGE:WA', `Gagal meneruskan pesan ke grup ${gJid}: ${err.message}`);
    }
  }
  return { sent, dryRun: false };
}

// =====================================================================
// 2. RELAY CHAT 2 ARAH (WA <-> MINECRAFT <-> DISCORD)
// =====================================================================

/**
 * Arah 1: WhatsApp Grup -> Minecraft & Discord
 */
async function relayFromWhatsApp({ chatJid, senderJid, pushName, body }) {
  if (!isWaGroupBridged(chatJid)) return;

  const trimmed = String(body || '').trim();
  if (!trimmed) return;

  // Abaikan command bot & pesan yang berasal dari bot sendiri
  const p = config.prefix || '.';
  if (trimmed.startsWith(p) || trimmed.startsWith('!') || trimmed.startsWith('/')) {
    return;
  }

  if (!allowBridgeThroughput(`wa:${senderJid}`)) {
    return;
  }

  // Jika akun WA sudah tertaut ke Minecraft, tampilkan nama MC-nya agar makin akrab!
  const linkRow = getVerifiedLinkByJid(senderJid);
  const displaySender = linkRow
    ? `${pushName || 'Member'} (${linkRow.mc_username})`
    : pushName || 'Member WA';

  const cleanMsg = trimmed
    .replace(/\s+/g, ' ')
    .slice(0, config.bridge?.maxMessageLength || 220);

  await Promise.allSettled([
    sendMinecraftBridgeChat({
      sourceTag: 'WA',
      sourceColor: 'green',
      senderName: displaySender,
      message: cleanMsg,
    }),
    sendDiscordBridgeMessage({
      sourceTag: 'WA',
      senderName: displaySender,
      text: cleanMsg,
    }),
  ]);
}

/**
 * Arah 2: Discord Channel Bridge -> WhatsApp & Minecraft
 */
async function relayFromDiscord({ authorName, content, messageId }) {
  const cleanMsg = String(content || '').trim();
  if (!cleanMsg) return;

  if (!allowBridgeThroughput(`dc:${authorName}`)) {
    return;
  }

  const waText = smallcaps(
    `❖ [ᴅɪsᴄᴏʀᴅ] *${keep(authorName)}*: ${keep(cleanMsg)}`
  );

  await Promise.allSettled([
    broadcastToBridgedWaGroups(waText),
    sendMinecraftBridgeChat({
      sourceTag: 'DC',
      sourceColor: 'aqua',
      senderName: authorName,
      message: cleanMsg,
    }),
  ]);

  return { ok: true, messageId };
}

/**
 * Arah 3: Console Minecraft (Chat, Verifikasi .link, Join/Leave) -> WhatsApp & Discord
 */
async function handleMinecraftConsoleLine(cleanLine) {
  if (!cleanLine) return;

  // Abaikan pantulan pesan bridge/pengumuman yang baru dikirim oleh bot sendiri
  if (
    cleanLine.includes('[WA]') ||
    cleanLine.includes('[DC]') ||
    cleanLine.includes('[CipiSMP]') ||
    cleanLine.includes('✿ Pengumuman')
  ) {
    return;
  }

  // 1. Cek Event Pemain Join (Java & Geyser Bedrock berawalan ".")
  const joinMatch = config.minecraft.joinRegex.exec(cleanLine);
  if (joinMatch) {
    const playerName = joinMatch[1].trim();
    const norm = normalizeMinecraftUsername(playerName);
    if (norm.valid) {
      onlinePlaytimeSessions.set(norm.normalized, Date.now());
      const debounceKey = `join:${norm.normalized}`;
      if (!joinLeaveDebounce.has(debounceKey) && isJoinLeaveNotifyEnabled()) {
        joinLeaveDebounce.set(debounceKey, Date.now());
        const editionTag = norm.isBedrock ? '[BE]' : '[Java]';
        const waJoin = smallcaps(
          `✿ [ᴍᴄ] *${keep(norm.display)}* ${keep(editionTag)} baru saja masuk ke server ♡`
        );
        await Promise.allSettled([
          broadcastToBridgedWaGroups(waJoin),
          sendDiscordStatusNotification({
            title: '✿ Pemain Masuk Server',
            description: `**${norm.display}** ${editionTag} bergabung ke dunia **${config.minecraft.host}** ♡`,
            color: 0x66bb6a,
          }),
        ]);
      }
    }
    return;
  }

  // 2. Cek Event Pemain Leave + Akumulasi Playtime Otomatis
  const leaveMatch = config.minecraft.leaveRegex.exec(cleanLine);
  if (leaveMatch) {
    const playerName = leaveMatch[1].trim();
    const norm = normalizeMinecraftUsername(playerName);
    if (norm.valid) {
      const joinedAt = onlinePlaytimeSessions.get(norm.normalized);
      onlinePlaytimeSessions.delete(norm.normalized);

      if (joinedAt) {
        const playedMinutes = Math.max(1, Math.round((Date.now() - joinedAt) / 60000));
        recordLinkedPlaytime(norm.normalized, playedMinutes);
      }

      const debounceKey = `leave:${norm.normalized}`;
      if (!joinLeaveDebounce.has(debounceKey) && isJoinLeaveNotifyEnabled()) {
        joinLeaveDebounce.set(debounceKey, Date.now());
        const editionTag = norm.isBedrock ? '[BE]' : '[Java]';
        const waLeave = smallcaps(
          `◦ [ᴍᴄ] *${keep(norm.display)}* ${keep(editionTag)} keluar dari server ✿`
        );
        await Promise.allSettled([
          broadcastToBridgedWaGroups(waLeave),
          sendDiscordStatusNotification({
            title: '❖ Pemain Keluar Server',
            description: `**${norm.display}** ${editionTag} telah meninggalkan server.`,
            color: 0xff8fb8,
          }),
        ]);
      }
    }
    return;
  }

  // 3. Cek Chat Pemain In-Game (<Nama> pesan)
  const chatMatch = config.minecraft.chatRegex.exec(cleanLine);
  if (!chatMatch) return;

  const rawPlayer = chatMatch[1].trim();
  const chatMessage = chatMatch[2].trim();
  if (!rawPlayer || !chatMessage) return;

  // Cek apakah pesan ini adalah kode verifikasi .link (CP-XXXXXX)
  // Jika cocok, verifikasi akun & JANGAN bocorkan kode ke grup publik!
  const codeMatch = /\b(CP-[A-Z0-9]{6})\b/i.exec(chatMessage);
  if (codeMatch) {
    const verifRes = await verifyAccountFromInGameChat(rawPlayer, codeMatch[1]);
    if (verifRes.verified) {
      return;
    }
  }

  if (chatMessage.startsWith('/') || chatMessage.startsWith('.')) return;
  if (!allowBridgeThroughput(`mc:${rawPlayer.toLowerCase()}`)) return;

  const norm = normalizeMinecraftUsername(rawPlayer);
  const badge = norm.isBedrock ? ' [BE]' : '';
  const trimmedChat = chatMessage.slice(0, config.bridge?.maxMessageLength || 220);

  const waRelayText = smallcaps(
    `✦ [ᴍᴄ${keep(badge)}] *${keep(rawPlayer)}*: ${keep(trimmedChat)}`
  );

  await Promise.allSettled([
    broadcastToBridgedWaGroups(waRelayText),
    sendDiscordBridgeMessage({
      sourceTag: norm.isBedrock ? 'MC•BE' : 'MC',
      senderName: rawPlayer,
      text: trimmedChat,
    }),
  ]);
}

/**
 * Handler Notifikasi Perubahan Status Server Nyala / Mati
 */
async function handleServerStatusTransition(nextState, prevState) {
  if (!isServerStatusNotifyEnabled()) return;
  if (!prevState || prevState === 'unknown' || prevState === nextState) return;

  if (nextState === 'running' || nextState === 'online') {
    const waUp = renderBox('✿ sᴇʀᴠᴇʀ ᴍɪɴᴇᴄʀᴀꜰᴛ ᴏɴʟɪɴᴇ', [
      `✦ Server ${keep(config.minecraft.host)} sekarang sudah NYALA ✅`,
      `✦ Port Bedrock: ${config.minecraft.bedrockPort}`,
      '◦ Yuk masuk dan bertualang bareng lagi ♡',
    ]);
    await Promise.allSettled([
      broadcastToBridgedWaGroups(waUp),
      sendDiscordStatusNotification({
        title: '✅ Server Minecraft ONLINE!',
        description: `Server **${config.minecraft.host}** (Bedrock Port \`${config.minecraft.bedrockPort}\`) sudah kembali menyala dan siap dimainkan ♡`,
        color: 0x66bb6a,
      }),
    ]);
    return;
  }

  if (nextState === 'offline') {
    const waDown = renderBox('❖ sᴇʀᴠᴇʀ ᴍɪɴᴇᴄʀᴀꜰᴛ ᴏꜰꜰʟɪɴᴇ', [
      `✦ Server ${keep(config.minecraft.host)} saat ini sedang MATI / Restart ❌`,
      '◦ Tunggu info selanjutnya ya sahabat Cipi ♡',
    ]);
    await Promise.allSettled([
      broadcastToBridgedWaGroups(waDown),
      sendDiscordStatusNotification({
        title: '❌ Server Minecraft OFFLINE',
        description: `Server **${config.minecraft.host}** baru saja berhenti atau sedang restart terjadwal.`,
        color: 0xef5350,
      }),
    ]);
  }
}

// =====================================================================
// 3. SISTEM TAUTAN AKUN WA <-> MINECRAFT (.link, .unlink, .akun, .tukar)
//    Mendukung penuh Java Edition & Geyser Bedrock (awalan "." / spasi)
// =====================================================================

function recordLinkedPlaytime(mcNormalized, minutes) {
  if (!mcNormalized || minutes <= 0) return;
  try {
    const db = getDb();
    const link = db.get(
      "SELECT jid FROM links WHERE mc_normalized = ? AND status = 'verified'",
      [mcNormalized]
    );
    if (link?.jid) {
      db.run(
        'UPDATE users SET playtime_minutes = playtime_minutes + ?, updated_at = ? WHERE jid = ?',
        [minutes, Date.now(), link.jid]
      );
    }
  } catch (err) {
    logger.warn('LINK:PLAYTIME', `Gagal mencatat playtime ${mcNormalized}: ${err.message}`);
  }
}

function getVerifiedLinkByJid(rawJid) {
  const jid = normalizeUserJid(rawJid);
  return (
    getDb().get(
      "SELECT * FROM links WHERE jid = ? AND status = 'verified'",
      [jid]
    ) || null
  );
}

function getAnyLinkByJid(rawJid) {
  const jid = normalizeUserJid(rawJid);
  return getDb().get('SELECT * FROM links WHERE jid = ?', [jid]) || null;
}

/**
 * Buat permintaan tautan akun baru (.link <username>)
 * Mendukung 2 jalur verifikasi aman anti-bajak:
 * 1) Ketik kode publik `CP-XXXXXX` di chat Minecraft (dibaca otomatis oleh Pterodactyl WebSocket)
 * 2) Baca PIN rahasia 6 angka yang dibisikkan (`/tell`) ke pemain di dalam Minecraft lalu ketik `.link verif <PIN>` di WA
 */
async function initiateAccountLink(rawJid, rawUsernameInput, editionFlag = '') {
  const jid = normalizeUserJid(rawJid);
  const db = getDb();
  const bedrockPrefix = config.minecraft.bedrockPrefix || '.';

  let candidateName = String(rawUsernameInput || '').trim();
  if (
    editionFlag.toLowerCase() === 'bedrock' &&
    candidateName &&
    !candidateName.startsWith(bedrockPrefix)
  ) {
    candidateName = `${bedrockPrefix}${candidateName}`;
  }

  const parsed = normalizeMinecraftUsername(candidateName);
  if (!parsed.valid) {
    return {
      ok: false,
      reason: 'invalid_username',
      isBedrockAttempt: parsed.isBedrock,
    };
  }

  // Pastikan user ini belum menautkan akun terverifikasi lain
  const myExisting = getAnyLinkByJid(jid);
  if (myExisting && myExisting.status === 'verified') {
    return {
      ok: false,
      reason: 'already_linked_self',
      existingUsername: myExisting.mc_username,
    };
  }

  // Pastikan username Minecraft ini belum diklaim user WA lain
  const takenRow = db.get(
    'SELECT * FROM links WHERE mc_normalized = ? AND jid != ?',
    [parsed.normalized, jid]
  );
  if (takenRow) {
    if (takenRow.status === 'verified') {
      return {
        ok: false,
        reason: 'username_taken',
        username: parsed.display,
      };
    }
    // Jika masih pending tetapi belum kedaluwarsa milik orang lain, tahan dulu
    if (Number(takenRow.verify_expires_at || 0) > Date.now()) {
      return {
        ok: false,
        reason: 'username_pending_other',
        username: parsed.display,
      };
    }
    // Jika pending orang lain sudah kedaluwarsa, bersihkan agar bisa dipakai
    db.run('DELETE FROM links WHERE id = ?', [takenRow.id]);
  }

  const publicChatCode = `CP-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
  const secretWhisperPin = String(crypto.randomInt(100000, 999999));
  const combinedToken = `${publicChatCode}|${secretWhisperPin}`;
  const now = Date.now();
  const expiresAt = now + Number(config.minecraft.verifyCodeTtlMs || 10 * 60 * 1000);

  db.run(
    `INSERT INTO links (
       jid, mc_username, mc_normalized, is_bedrock, verify_code, verify_expires_at, status, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(jid) DO UPDATE SET
       mc_username = excluded.mc_username,
       mc_normalized = excluded.mc_normalized,
       is_bedrock = excluded.is_bedrock,
       verify_code = excluded.verify_code,
       verify_expires_at = excluded.verify_expires_at,
       status = 'pending',
       updated_at = excluded.updated_at`,
    [
      jid,
      parsed.display,
      parsed.normalized,
      parsed.isBedrock ? 1 : 0,
      combinedToken,
      expiresAt,
      now,
    ]
  );

  // Kirim bisikan PIN rahasia ke dalam game bila Pterodactyl/RCON tersedia
  let whisperSent = false;
  try {
    const wRes = await whisperMinecraftPlayer(
      parsed.display,
      `[CipiSMP] PIN Verifikasi WA kamu: ${secretWhisperPin} (atau ketik ${publicChatCode} di chat publik). Berlaku 10 menit!`
    );
    whisperSent = Boolean(wRes.ok);
  } catch {
    whisperSent = false;
  }

  return {
    ok: true,
    mcUsername: parsed.display,
    mcNormalized: parsed.normalized,
    isBedrock: parsed.isBedrock,
    publicChatCode,
    expiresInMinutes: Math.round((expiresAt - now) / 60000),
    whisperSent,
  };
}

/**
 * Jalur Verifikasi 1: Otomatis saat pemain mengetik kode `CP-XXXXXX` di chat Minecraft
 */
async function verifyAccountFromInGameChat(mcSenderRaw, submittedPublicCode) {
  const parsedSender = normalizeMinecraftUsername(mcSenderRaw);
  if (!parsedSender.valid) return { verified: false };

  const db = getDb();
  const row = db.get(
    "SELECT * FROM links WHERE mc_normalized = ? AND status = 'pending'",
    [parsedSender.normalized]
  );
  if (!row) return { verified: false };

  if (Number(row.verify_expires_at || 0) < Date.now()) {
    return { verified: false, reason: 'expired' };
  }

  const [expectedPublicCode] = String(row.verify_code || '').split('|');
  if (
    !expectedPublicCode ||
    expectedPublicCode.toUpperCase() !== String(submittedPublicCode || '').toUpperCase()
  ) {
    return { verified: false, reason: 'mismatch' };
  }

  const now = Date.now();
  db.run(
    `UPDATE links
     SET status = 'verified',
         mc_username = ?,
         verify_code = NULL,
         verify_expires_at = NULL,
         linked_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [parsedSender.display, now, now, row.id]
  );

  addAuditLog({
    category: 'mc_link',
    actorJid: row.jid,
    target: parsedSender.display,
    action: 'verified_via_chat',
    details: { isBedrock: parsedSender.isBedrock },
  });

  // Beri tahu di Minecraft & kirim pesan sukses ke WhatsApp user!
  await whisperMinecraftPlayer(
    parsedSender.display,
    `[CipiSMP] Yatta! Akun Minecraft kamu berhasil tertaut ke WhatsApp!`
  ).catch(() => {});

  if (activeWaSock && !config.dryRun) {
    try {
      await activeWaSock.sendMessage(row.jid, {
        text: formatSuccess('Akun Minecraft Tertaut!', [
          `Selamat! Akun ${keep(parsedSender.display)} (${
            parsedSender.isBedrock ? 'Bedrock / Geyser' : 'Java Edition'
          }) resmi terhubung dengan WhatsApp kamu ♡`,
          `Cek status akunmu kapan saja lewat ${mono(`${config.prefix}akun`)} atau tukar poin lewat ${mono(`${config.prefix}tukar`)}!`,
        ]),
      });
    } catch (err) {
      logger.warn('LINK', `Gagal mengirim notif WA verifikasi sukses: ${err.message}`);
    }
  }

  return { verified: true, jid: row.jid, mcUsername: parsedSender.display };
}

/**
 * Jalur Verifikasi 2: User mengetik `.link verif <6-digit PIN>` di WA (PIN dari bisikan /tell di Minecraft)
 */
function verifyAccountFromWhisperPin(rawJid, submittedPin) {
  const jid = normalizeUserJid(rawJid);
  const db = getDb();
  const row = db.get(
    "SELECT * FROM links WHERE jid = ? AND status = 'pending'",
    [jid]
  );

  if (!row) {
    return { ok: false, reason: 'no_pending' };
  }

  if (Number(row.verify_expires_at || 0) < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const parts = String(row.verify_code || '').split('|');
  const secretPin = parts[1] || '';
  const cleanInput = String(submittedPin || '').trim();

  if (!secretPin || cleanInput !== secretPin) {
    return { ok: false, reason: 'invalid_pin' };
  }

  const now = Date.now();
  db.run(
    `UPDATE links
     SET status = 'verified',
         verify_code = NULL,
         verify_expires_at = NULL,
         linked_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [now, now, row.id]
  );

  addAuditLog({
    category: 'mc_link',
    actorJid: jid,
    target: row.mc_username,
    action: 'verified_via_pin',
    details: { isBedrock: Boolean(row.is_bedrock) },
  });

  return {
    ok: true,
    mcUsername: row.mc_username,
    isBedrock: Boolean(row.is_bedrock),
  };
}

/**
 * Lepas tautan akun Minecraft (.unlink)
 */
function unlinkAccount(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const db = getDb();
  const existing = getAnyLinkByJid(jid);
  if (!existing) {
    return { ok: false, reason: 'not_linked' };
  }

  db.run('DELETE FROM links WHERE jid = ?', [jid]);

  addAuditLog({
    category: 'mc_link',
    actorJid: jid,
    target: existing.mc_username,
    action: 'unlinked',
    details: { prevStatus: existing.status },
  });

  return {
    ok: true,
    previousUsername: existing.mc_username,
    wasVerified: existing.status === 'verified',
  };
}

/**
 * Ambil ringkasan lengkap akun tertaut & kuota harian penukaran poin (.akun)
 */
function getLinkedAccountDetails(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const db = getDb();
  const link = getAnyLinkByJid(jid);
  if (!link) return null;

  const user = db.get('SELECT playtime_minutes FROM users WHERE jid = ?', [jid]);
  const todayKey = getWibDateKey();
  const maxDaily = Number(config.minecraft.dailyRewardLimit || 3);
  const usedToday =
    link.daily_reward_date === todayKey ? Number(link.daily_reward_count || 0) : 0;

  return {
    jid,
    mcUsername: link.mc_username,
    mcNormalized: link.mc_normalized,
    isBedrock: Boolean(link.is_bedrock),
    status: link.status,
    linkedAt: link.linked_at ? Number(link.linked_at) : null,
    verifyExpiresAt: link.verify_expires_at ? Number(link.verify_expires_at) : null,
    playtimeMinutes: Number(user?.playtime_minutes || 0),
    dailyRewardUsed: usedToday,
    dailyRewardMax: maxDaily,
    dailyRewardRemaining: Math.max(0, maxDaily - usedToday),
  };
}

/**
 * Tukar Sakura Coin dari chat WA ke hadiah item in-game Minecraft (.tukar)
 * Otomatis mengembalikan koin bila server Minecraft gagal menerima command!
 */
async function redeemCoinsForMcReward(rawJid, rewardKeyInput = '') {
  const jid = normalizeUserJid(rawJid);
  const details = getLinkedAccountDetails(jid);

  if (!details || details.status !== 'verified') {
    return { ok: false, reason: 'not_verified' };
  }

  const rewardsCatalog = config.minecraft.rewards || {};
  const key = String(rewardKeyInput || '').toLowerCase().trim();
  const reward = rewardsCatalog[key];
  if (!reward) {
    return { ok: false, reason: 'invalid_reward', catalog: rewardsCatalog };
  }

  if (details.dailyRewardRemaining <= 0) {
    return {
      ok: false,
      reason: 'daily_limit_reached',
      maxDaily: details.dailyRewardMax,
    };
  }

  const wallet = getEconomy(jid);
  if (wallet.balance < reward.cost) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      balance: wallet.balance,
      cost: reward.cost,
    };
  }

  // 1. Potong saldo Sakura Coin terlebih dahulu
  const deductRes = deductBalance(jid, reward.cost);
  if (!deductRes.ok) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      balance: wallet.balance,
      cost: reward.cost,
    };
  }

  // 2. Bangun command Minecraft yang aman untuk Java maupun Bedrock
  const safePlayerArg = formatSafeMcTarget(details.mcUsername);
  const finalCommand = String(reward.command).replace(/\{player\}/g, safePlayerArg);

  const execRes = await executeMinecraftCommand(finalCommand);
  if (!execRes.ok) {
    // Refund otomatis 100% bila koneksi Pterodactyl/RCON gagal
    addBalance(jid, reward.cost);
    return {
      ok: false,
      reason: 'delivery_failed',
      error: execRes.error,
    };
  }

  // 3. Catat pemakaian kuota harian WIB di tabel links & log audit
  const todayKey = getWibDateKey();
  const nextCount = details.dailyRewardUsed + 1;
  getDb().run(
    `UPDATE links
     SET daily_reward_date = ?,
         daily_reward_count = ?,
         updated_at = ?
     WHERE jid = ?`,
    [todayKey, nextCount, Date.now(), jid]
  );

  // Kirim notifikasi manis ke dalam game (opsional, abaikan bila gagal)
  whisperMinecraftPlayer(
    details.mcUsername,
    `[CipiSMP] Hadiah .tukar (${reward.label}) telah dikirim ke inventori kamu!`
  ).catch(() => {});

  addAuditLog({
    category: 'mc_reward',
    actorJid: jid,
    target: details.mcUsername,
    action: 'redeem_success',
    details: {
      rewardKey: key,
      label: reward.label,
      cost: reward.cost,
      via: execRes.via,
      dryRun: Boolean(execRes.dryRun),
    },
  });

  return {
    ok: true,
    mcUsername: details.mcUsername,
    isBedrock: details.isBedrock,
    rewardKey: key,
    rewardLabel: reward.label,
    cost: reward.cost,
    newBalance: deductRes.newBalance,
    remainingDaily: Math.max(0, details.dailyRewardMax - nextCount),
    maxDaily: details.dailyRewardMax,
    via: execRes.via,
    dryRun: Boolean(execRes.dryRun),
  };
}

// =====================================================================
// 4. FALLBACK POLLING STATUS SERVER & REGISTRASI HOOKS INDEX.JS
// =====================================================================

function startFallbackStatusPoller() {
  if (statusPollTimer) return;
  const intervalMs = Number(config.bridge?.statusPollIntervalMs || 60000);

  statusPollTimer = setInterval(async () => {
    try {
      // Jika WebSocket Pterodactyl sudah aktif terhubung, tidak perlu polling ganda
      if (getPteroStreamState().connected) return;
      if (!isServerStatusNotifyEnabled()) return;
      if (getEnabledBridgeGroups().length === 0 && !config.discord.statusChannelId && !config.discord.webhookUrl) {
        return;
      }

      const st = await fetchMinecraftServerStatus();
      if (!st.ok) return;

      if (lastPolledOnline !== null && lastPolledOnline !== st.online) {
        await handleServerStatusTransition(
          st.online ? 'online' : 'offline',
          lastPolledOnline ? 'online' : 'offline'
        );
      }
      lastPolledOnline = st.online;
    } catch (err) {
      logger.debug('BRIDGE:POLL', `Polling status server dilewati: ${err.message}`);
    }
  }, intervalMs);

  if (typeof statusPollTimer.unref === 'function') statusPollTimer.unref();
}

function stopBridgeServices() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  stopPteroConsoleStream();
}

/**
 * Integrasi otomatis ke sistem hook index.js
 */
function register({ registerHook }) {
  // Sambungkan listener Discord -> WA & Minecraft
  setDiscordBridgeListeners({
    onBridgeMessage: relayFromDiscord,
  });

  // Nyalakan stream WebSocket Pterodactyl Wings & fallback poller
  startPteroConsoleStream({
    onConsoleLine: handleMinecraftConsoleLine,
    onStatusChange: handleServerStatusTransition,
  }).catch((err) => logger.error('BRIDGE', 'Gagal memulai stream Pterodactyl', err));

  startFallbackStatusPoller();

  // Saat socket WhatsApp terbuka: simpan referensi & kirim pemberitahuan privasi awal ke grup bridge baru
  registerHook('onSocketReady', async (sock) => {
    activeWaSock = sock;
    const bridgedGroups = getEnabledBridgeGroups();
    for (const gJid of bridgedGroups) {
      const noticeKey = `bridge_privacy_notified:${gJid}`;
      if (getSetting(noticeKey, 'false') !== 'true' && !config.dryRun) {
        try {
          await sock.sendMessage(gJid, { text: buildBridgePrivacyNotice() });
          setSetting(noticeKey, 'true');
        } catch (err) {
          logger.warn('BRIDGE', `Gagal mengirim pemberitahuan privasi awal ke ${gJid}: ${err.message}`);
        }
      }
    }
  });

  // Saat ada member baru masuk ke grup WA yang di-bridge, ingatkan soal privasi bridge
  registerHook('onGroupParticipantsUpdate', async (sock, event) => {
    if (!event?.id || event.action !== 'add' || !isWaGroupBridged(event.id) || config.dryRun) {
      return;
    }
    try {
      await sock.sendMessage(event.id, {
        text: smallcaps(
          `✿ ɪɴꜰᴏ ᴘʀɪᴠᴀsɪ: grup ini terhubung langsung ke chat server minecraft & discord ${keep(config.botName)} (isi chat tidak disimpan di database) ♡`
        ),
      });
    } catch {
      // Abaikan bila gagal kirim
    }
  });

  // Teruskan pesan teks biasa dari grup WA yang di-bridge ke Minecraft & Discord
  registerHook('onMessagePreCommand', async ({ chatJid, senderJid, pushName, isGroup, body, msg }) => {
    if (!isGroup || msg?.key?.fromMe) return;
    await relayFromWhatsApp({ chatJid, senderJid, pushName, body });
  });

  process.once('SIGINT', () => stopBridgeServices());
  process.once('SIGTERM', () => stopBridgeServices());

  logger.info('BRIDGE', 'Jembatan Komunitas 2 Arah (WA <-> Minecraft <-> Discord) & Tautan Akun aktif');
}

module.exports = {
  getEnabledBridgeGroups,
  isWaGroupBridged,
  setWaGroupBridgeState,
  isJoinLeaveNotifyEnabled,
  isServerStatusNotifyEnabled,
  buildBridgePrivacyNotice,
  relayFromWhatsApp,
  relayFromDiscord,
  handleMinecraftConsoleLine,
  handleServerStatusTransition,
  getVerifiedLinkByJid,
  getAnyLinkByJid,
  getLinkedAccountDetails,
  initiateAccountLink,
  verifyAccountFromInGameChat,
  verifyAccountFromWhisperPin,
  unlinkAccount,
  redeemCoinsForMcReward,
  stopBridgeServices,
  register,
};
