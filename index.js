const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Boom } = require('@hapi/boom');

const config = require('./config');
const {
  initDatabase,
  closeDatabase,
  ensureUser,
  ensureGroup,
  normalizeUserJid,
  registerLidMapping,
  extractPhoneFromJid,
  isOwner,
  getPremiumStatus,
  getSetting,
} = require('./lib/database');
const {
  smallcaps,
  renderBox,
  formatWarning,
  formatError,
  mono,
  keep,
} = require('./lib/smallcaps');
const {
  sendButtons,
  extractButtonResponse,
  resolveButtonInteraction,
  unwrapMessageContent,
} = require('./lib/buttons');
const { checkRateLimit, checkCooldown } = require('./lib/limits');
const { startBackupScheduler, stopBackupScheduler } = require('./lib/backup');
const {
  attachBotRuntimeToPanel,
  startControlPanelServer,
  stopControlPanelServer,
} = require('./lib/panel');
const { logger, baileysLogger } = require('./lib/logger');

const botStartTime = Date.now();
const commands = new Map();
const aliases = new Map();
const groupMetaCache = new Map();

// Hook ekstensi modular untuk Fase 2 s/d Fase 7 (antilink, XP, welcome, bridge, scheduler)
const hooks = {
  onMessagePreCommand: [],
  onGroupParticipantsUpdate: [],
  onSocketReady: [],
  onCommandSuccess: [],
};

let activeSock = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isShuttingDown = false;
let pairingRequested = false;
let waConnectionStatus = 'offline';
let latestPairingCode = null;

/**
 * Daftarkan hook ekstensi untuk modul lintas fase
 */
function registerHook(hookName, handlerFn) {
  if (hooks[hookName] && typeof handlerFn === 'function') {
    hooks[hookName].push(handlerFn);
  }
}

/**
 * Muat semua file command secara rekursif dari commands/<kategori>/*.js
 */
function loadCommands() {
  commands.clear();
  aliases.clear();

  const rootDir = config.paths.commandsDir;
  if (!fs.existsSync(rootDir)) return { count: 0 };

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

      try {
        const resolved = require.resolve(fullPath);
        delete require.cache[resolved];
        const cmd = require(resolved);
        if (!cmd || !cmd.name || typeof cmd.execute !== 'function') {
          logger.warn('LOADER', `Melewati file command tidak valid: ${entry.name}`);
          continue;
        }

        const primaryName = String(cmd.name).trim().toLowerCase();
        const inferredCategory = path.basename(path.dirname(fullPath)).toLowerCase();
        const normalizedCmd = {
          ...cmd,
          name: primaryName,
          alias: Array.isArray(cmd.alias)
            ? cmd.alias.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
            : [],
          category: String(cmd.category || inferredCategory || 'info').toLowerCase(),
          description: cmd.description || '',
          cooldown:
            cmd.cooldown !== undefined ? Number(cmd.cooldown) : config.cooldown.defaultSec,
          groupOnly: Boolean(cmd.groupOnly),
          adminOnly: Boolean(cmd.adminOnly),
          ownerOnly: Boolean(cmd.ownerOnly),
          premiumOnly: Boolean(cmd.premiumOnly),
          filePath: fullPath,
        };

        commands.set(primaryName, normalizedCmd);
        for (const al of normalizedCmd.alias) {
          aliases.set(al, primaryName);
        }
      } catch (err) {
        logger.error('LOADER', `Gagal memuat command ${fullPath}`, err);
      }
    }
  };

  walk(rootDir);
  logger.info('LOADER', `Berhasil memuat ${commands.size} command utama (${aliases.size} alias)`);
  return { count: commands.size, aliasCount: aliases.size };
}

/**
 * Ekspor daftar katalog command terurut untuk Cipi Panel
 */
function getCommandsCatalog() {
  return Array.from(commands.values())
    .map((c) => ({
      name: c.name,
      aliases: c.alias || [],
      category: c.category || 'general',
      description: c.description || '-',
      cooldown: Number(c.cooldown || 0),
      groupOnly: Boolean(c.groupOnly),
      adminOnly: Boolean(c.adminOnly),
      ownerOnly: Boolean(c.ownerOnly),
      premiumOnly: Boolean(c.premiumOnly),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/**
 * Cari definisi command berdasarkan nama atau alias
 */
function resolveCommand(triggerName) {
  const key = String(triggerName || '').trim().toLowerCase();
  if (!key) return null;
  if (commands.has(key)) return commands.get(key);
  const primary = aliases.get(key);
  return primary ? commands.get(primary) || null : null;
}

/**
 * Resolusi JID pengirim paling akurat (mendukung Baileys v7 LID + participantAlt / remoteJidAlt)
 */
function harvestLidMappingFromParticipant(entry) {
  if (!entry || typeof entry !== 'object') return;
  const candidates = [entry.id, entry.jid, entry.lid, entry.phoneNumber].filter(Boolean);
  const lid = candidates.find((c) => String(c).endsWith('@lid'));
  const pn = candidates.find(
    (c) => String(c).endsWith('@s.whatsapp.net') || /^[0-9]{8,16}$/.test(String(c))
  );
  if (lid && pn) {
    registerLidMapping(lid, pn);
  }
}

/**
 * Resolusi JID pengirim paling akurat (mendukung Baileys v7 LID + participantAlt / remoteJidAlt)
 */
function resolveSenderJid(msg, sock) {
  const key = msg?.key || {};
  const isGroup = String(key.remoteJid || '').endsWith('@g.us');

  if (key.fromMe && sock?.user?.id) {
    if (sock.user.lid) {
      registerLidMapping(sock.user.lid, sock.user.id);
    }
    return normalizeUserJid(sock.user.id);
  }

  if (isGroup) {
    if (key.participant && key.participantAlt) {
      if (String(key.participant).endsWith('@lid') && !String(key.participantAlt).endsWith('@lid')) {
        registerLidMapping(key.participant, key.participantAlt);
      } else if (String(key.participantAlt).endsWith('@lid') && !String(key.participant).endsWith('@lid')) {
        registerLidMapping(key.participantAlt, key.participant);
      }
    }
    const candidate =
      key.participantAlt && !String(key.participantAlt).endsWith('@lid')
        ? key.participantAlt
        : key.participant || key.participantAlt || '';
    return normalizeUserJid(candidate);
  }

  if (key.remoteJid && key.remoteJidAlt) {
    if (String(key.remoteJid).endsWith('@lid') && !String(key.remoteJidAlt).endsWith('@lid')) {
      registerLidMapping(key.remoteJid, key.remoteJidAlt);
    } else if (String(key.remoteJidAlt).endsWith('@lid') && !String(key.remoteJid).endsWith('@lid')) {
      registerLidMapping(key.remoteJidAlt, key.remoteJid);
    }
  }

  const dmCandidate =
    key.remoteJidAlt && !String(key.remoteJidAlt).endsWith('@lid')
      ? key.remoteJidAlt
      : key.remoteJid || key.remoteJidAlt || '';
  return normalizeUserJid(dmCandidate);
}

/**
 * Terjemahkan JID @lid menjadi JID nomor asli @s.whatsapp.net menggunakan cache,
 * groupMetadata partisipan grup, maupun signalRepository.lidMapping Baileys v7!
 */
async function resolveLidJidAsync(sock, chatJid, rawJid) {
  if (!rawJid) return '';
  let norm = normalizeUserJid(rawJid);
  if (!norm.endsWith('@lid')) return norm;

  // 1. Jika di grup, muat metadata grup untuk memanen pasangan lid <-> phoneNumber seluruh member
  if (chatJid && chatJid.endsWith('@g.us') && sock) {
    await getCachedGroupMetadata(sock, chatJid);
    norm = normalizeUserJid(rawJid);
    if (!norm.endsWith('@lid')) return norm;
  }

  // 2. Tanya langsung ke LIDMappingStore internal Baileys v7 bila tersedia
  try {
    const lidStore = sock?.signalRepository?.lidMapping;
    if (lidStore && typeof lidStore.getPNForLID === 'function') {
      const pn = await lidStore.getPNForLID(norm);
      if (pn && !String(pn).endsWith('@lid')) {
        const mapped = registerLidMapping(norm, pn);
        if (mapped) return mapped;
      }
    }
  } catch {
    // Abaikan bila belum termuat di signal store
  }

  return norm;
}

/**
 * Ekstrak teks biasa & daftar @mention dari pesan masuk
 */
function extractMessageTextAndMentions(rawMessage) {
  const m = unwrapMessageContent(rawMessage);
  if (!m) return { body: '', mentionedJids: [] };

  const body =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    '';

  const contextInfo =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    m.buttonsResponseMessage?.contextInfo ||
    m.listResponseMessage?.contextInfo ||
    m.interactiveResponseMessage?.contextInfo ||
    null;

  const mentionedJids = Array.isArray(contextInfo?.mentionedJid)
    ? contextInfo.mentionedJid.map((j) => normalizeUserJid(j))
    : [];

  const quotedMessage = contextInfo?.quotedMessage
    ? unwrapMessageContent(contextInfo.quotedMessage)
    : null;
  const quotedSenderJid = contextInfo?.participant
    ? normalizeUserJid(contextInfo.participant)
    : null;

  return {
    body: String(body || ''),
    mentionedJids,
    contextInfo,
    quotedMessage,
    quotedSenderJid,
  };
}

/**
 * Hapus cache metadata grup tertentu (dipakai setelah kick/promote/demote/setting)
 */
function invalidateGroupCache(groupJid) {
  if (groupJid) groupMetaCache.delete(groupJid);
}

/**
 * Ambil metadata grup dengan cache singkat 45 detik agar cepat & bebas rate-limit WA
 */
async function getCachedGroupMetadata(sock, groupJid) {
  const cached = groupMetaCache.get(groupJid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  try {
    const data = await sock.groupMetadata(groupJid);
    if (Array.isArray(data?.participants)) {
      for (const p of data.participants) {
        harvestLidMappingFromParticipant(p);
      }
    }
    groupMetaCache.set(groupJid, {
      data,
      expiresAt: Date.now() + 45 * 1000,
    });
    return data;
  } catch (err) {
    logger.warn('GROUP', `Gagal mengambil metadata grup ${groupJid}: ${err.message}`);
    return null;
  }
}

/**
 * Cek status admin pengirim & bot di dalam grup
 */
async function getGroupAdminFlags(sock, groupJid, senderJid) {
  const meta = await getCachedGroupMetadata(sock, groupJid);
  if (!meta || !Array.isArray(meta.participants)) {
    return { isAdmin: false, isBotAdmin: false, groupName: '' };
  }

  const senderPhone = extractPhoneFromJid(senderJid);
  const botJid = normalizeUserJid(sock?.user?.id || '');
  const botLid = normalizeUserJid(sock?.user?.lid || '');
  const botPhone = extractPhoneFromJid(botJid);

  let isAdmin = false;
  let isBotAdmin = false;

  for (const p of meta.participants) {
    const pAdmin = p.admin === 'admin' || p.admin === 'superadmin';
    if (!pAdmin) continue;

    const pJid = normalizeUserJid(p.jid || p.phoneNumber || p.id || '');
    const pLid = normalizeUserJid(p.lid || p.id || '');
    const pPhone = extractPhoneFromJid(pJid);

    if (pJid === senderJid || pLid === senderJid || (senderPhone && pPhone === senderPhone)) {
      isAdmin = true;
    }
    if (
      pJid === botJid ||
      (botLid && pLid === botLid) ||
      (botPhone && pPhone === botPhone)
    ) {
      isBotAdmin = true;
    }
  }

  return {
    isAdmin,
    isBotAdmin,
    groupName: meta.subject || '',
    groupMeta: meta,
  };
}

/**
 * Kirim reaksi emoji otomatis pada pesan user (⏳ -> ✅ / ❌)
 */
async function reactToMessage(sock, msg, emoji) {
  if (!sock || !msg?.key) return;
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: {
        text: emoji,
        key: msg.key,
      },
    });
  } catch {
    // Abaikan kegagalan kecil saat mengirim reaksi agar tidak mengganggu alur utama
  }
}

/**
 * Sanitasi input teks argumen user (hapus karakter kontrol berbahaya, batasi panjang wajar)
 */
function sanitizeUserInput(raw = '') {
  return String(raw || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 4000)
    .trim();
}

const botSentMessageIds = new Set();

function recordBotSentId(stanzaId) {
  if (!stanzaId) return;
  if (botSentMessageIds.size >= 800) {
    const oldest = botSentMessageIds.values().next().value;
    if (oldest !== undefined) botSentMessageIds.delete(oldest);
  }
  botSentMessageIds.add(String(stanzaId));
}

function wrapSocketOutgoingTracker(sock) {
  if (!sock || sock._cipiOutgoingTracked) return sock;
  Object.defineProperty(sock, '_cipiOutgoingTracked', { value: true, enumerable: false });

  if (typeof sock.sendMessage === 'function') {
    const origSend = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
      const sentRes = await origSend(...args);
      if (sentRes?.key?.id) recordBotSentId(sentRes.key.id);
      return sentRes;
    };
  }
  if (typeof sock.relayMessage === 'function') {
    const origRelay = sock.relayMessage.bind(sock);
    sock.relayMessage = async (jid, message, opts = {}) => {
      if (opts?.messageId) recordBotSentId(opts.messageId);
      const relayRes = await origRelay(jid, message, opts);
      if (typeof relayRes === 'string') recordBotSentId(relayRes);
      return relayRes;
    };
  }
  return sock;
}

/**
 * Handler utama setiap pesan & balasan tombol masuk
 */
async function handleIncomingMessage(sock, msg) {
  if (!msg || !msg.message || !msg.key) return;
  wrapSocketOutgoingTracker(sock);

  // Abaikan pantulan pesan (echo) yang baru saja dikirim oleh bot sendiri
  if (msg.key.fromMe && msg.key.id && botSentMessageIds.has(String(msg.key.id))) {
    return;
  }

  const chatJid = msg.key.remoteJid || '';
  if (!chatJid || chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) {
    return;
  }

  const isGroup = chatJid.endsWith('@g.us');
  const initialSenderJid = resolveSenderJid(msg, sock);
  if (!initialSenderJid) return;
  const senderJid = await resolveLidJidAsync(sock, chatJid, initialSenderJid);

  // Cegah loop pesan yang dikirim bot sendiri kecuali pemilik mengetes di mode self
  if (msg.key.fromMe && !isOwner(senderJid)) {
    return;
  }

  const senderNumber = extractPhoneFromJid(senderJid);
  const pushName = sanitizeUserInput(msg.pushName || '').slice(0, 48) || 'Sahabat Cipi';

  // Pastikan user & grup tercatat di SQLite
  const userRow = ensureUser(senderJid, pushName);
  if (isGroup) {
    ensureGroup(chatJid);
  }

  // 1. Cek apakah pesan ini adalah balasan klik tombol interaktif
  let effectiveBody = '';
  let mentionedJids = [];
  let contextInfo = null;
  let quotedMessage = null;
  let quotedSenderJid = null;
  const btnResp = extractButtonResponse(msg.message);

  if (btnResp && btnResp.rawId) {
    const check = resolveButtonInteraction(btnResp.rawId, senderJid);
    if (!check.valid) {
      if (check.reason === 'not_owner') {
        const ownerNum = extractPhoneFromJid(check.ownerJid || '');
        const ownerTag = ownerNum ? `@${ownerNum}` : 'pemiliknya';
        await sock.sendMessage(
          chatJid,
          {
            text: formatError('Tombol Terkunci', [
              `Eits, tombol ini khusus milik ${ownerTag} ya kak ♡`,
              `Ketik command sendiri yuk, misalnya ${mono(`${config.prefix}menu`)}`,
            ]),
            mentions: check.ownerJid ? [check.ownerJid] : [],
          },
          { quoted: msg }
        );
      } else if (check.reason === 'expired') {
        await sock.sendMessage(
          chatJid,
          {
            text: formatError('Tombol Kedaluwarsa', [
              'Masa aktif tombol ini sudah habis nih kak ♡',
              `Silakan ketik ulang ${mono(`${config.prefix}menu`)} atau command yang diinginkan ya!`,
            ]),
          },
          { quoted: msg }
        );
      }
      return;
    }
    effectiveBody = check.commandText || '';
  } else {
    const extracted = extractMessageTextAndMentions(msg.message);
    effectiveBody = extracted.body;
    mentionedJids =
      Array.isArray(extracted.mentionedJids) && extracted.mentionedJids.length > 0
        ? await Promise.all(
            extracted.mentionedJids.map((j) => resolveLidJidAsync(sock, chatJid, j))
          )
        : [];
    contextInfo = extracted.contextInfo;
    quotedMessage = extracted.quotedMessage;
    quotedSenderJid = extracted.quotedSenderJid
      ? await resolveLidJidAsync(sock, chatJid, extracted.quotedSenderJid)
      : null;
  }

  // 2. Jalankan pre-command hooks (untuk antilink, antispam, XP otomatis, bridge di fase berikutnya)
  for (const hookFn of hooks.onMessagePreCommand) {
    try {
      const hookRes = await hookFn({
        sock,
        msg,
        chatJid,
        senderJid,
        senderNumber,
        pushName,
        isGroup,
        body: effectiveBody,
        userRow,
        mentionedJids,
        quotedMessage,
        quotedSenderJid,
        contextInfo,
      });
      if (hookRes && hookRes.stopProcessing) {
        return;
      }
    } catch (err) {
      logger.error('HOOK', 'Kesalahan pada pre-command hook', err);
    }
  }

  const trimmed = effectiveBody.trim();
  const activePrefix = config.prefix || '.';
  if (!trimmed.startsWith(activePrefix)) {
    return;
  }

  // 3. Parsing trigger command & argumen (input tetap huruf asli, tidak diubah smallcaps)
  const withoutPrefix = sanitizeUserInput(trimmed.slice(activePrefix.length));
  if (!withoutPrefix) return;

  const tokens = withoutPrefix.split(/\s+/);
  const invokedTrigger = (tokens.shift() || '').toLowerCase();
  const rawArgsText = withoutPrefix.slice(invokedTrigger.length).trim();
  const cmd = resolveCommand(invokedTrigger);
  if (!cmd) return;

  const senderIsOwner = isOwner(senderJid);
  const premiumInfo = getPremiumStatus(senderJid);

  // 4. Cek mode bot (self / public) & maintenance
  const botMode = getSetting('bot_mode', 'public');
  if (botMode === 'self' && !senderIsOwner) {
    return;
  }

  const isMaintenance = getSetting('maintenance', 'false') === 'true';
  if (isMaintenance && !senderIsOwner) {
    const reason = getSetting('maintenance_reason', 'Bot sedang dalam perawatan rutin ♡');
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Mode Maintenance', [
          reason,
          'Tunggu sebentar ya kak, nanti kita main bareng lagi ♡',
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  // 5. Cek status ban user
  if (userRow?.is_banned && !senderIsOwner) {
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Akses Dibatasi', [
          'Maaf kak, akunmu sedang dibatasi untuk memakai bot ini.',
          userRow.ban_reason ? `Alasan: ${keep(userRow.ban_reason)}` : 'Hubungi owner bila ini kekeliruan ya ♡',
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  // 6. Validasi flag command (ownerOnly, premiumOnly, groupOnly, adminOnly)
  if (cmd.ownerOnly && !senderIsOwner) {
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Khusus Owner', [
          `Command ${mono(`${activePrefix}${cmd.name}`)} hanya bisa dijalankan oleh Owner ya kak ♡`,
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  if (cmd.premiumOnly && !premiumInfo.isPremium) {
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Khusus Sakura VIP', [
          `Fitur ${mono(`${activePrefix}${cmd.name}`)} khusus member Premium VIP nih ♡`,
          `Hubungi ${mono(`${activePrefix}owner`)} untuk info upgrade VIP ya!`,
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  if (cmd.groupOnly && !isGroup) {
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Khusus di Grup', [
          `Command ${mono(`${activePrefix}${cmd.name}`)} hanya bisa dipakai di dalam grup ya kak ♡`,
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  let isAdmin = false;
  let isBotAdmin = false;
  let groupMeta = null;

  if (isGroup && (cmd.adminOnly || cmd.botAdminOnly)) {
    const flags = await getGroupAdminFlags(sock, chatJid, senderJid);
    isAdmin = flags.isAdmin;
    isBotAdmin = flags.isBotAdmin;
    groupMeta = flags.groupMeta;
    if (flags.groupName) ensureGroup(chatJid, flags.groupName);

    if (cmd.adminOnly && !isAdmin && !senderIsOwner) {
      await sock.sendMessage(
        chatJid,
        {
          text: formatError('Khusus Admin Grup', [
            `Command ${mono(`${activePrefix}${cmd.name}`)} hanya untuk Admin Grup ya kak ♡`,
          ]),
        },
        { quoted: msg }
      );
      return;
    }

    if (cmd.botAdminOnly && !isBotAdmin) {
      await sock.sendMessage(
        chatJid,
        {
          text: formatError('Bot Belum Admin', [
            'Jadikan aku Admin Grup dulu supaya bisa menjalankan perintah ini ya ♡',
          ]),
        },
        { quoted: msg }
      );
      return;
    }
  }

  // 7. Cek Rate Limit & Cooldown per Command
  const rateCheck = checkRateLimit(senderJid);
  if (!rateCheck.allowed) {
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Pelan-Pelan Yuk', [
          `Kamu mengirim command terlalu cepat nih kak ♡`,
          `Tunggu ${rateCheck.retryAfterSec} detik lagi ya!`,
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  const cdCheck = checkCooldown(senderJid, cmd.name, cmd.cooldown);
  if (!cdCheck.allowed) {
    await sock.sendMessage(
      chatJid,
      {
        text: formatError('Cooldown Aktif', [
          `Sabar sebentar ya kak, tunggu ${cdCheck.remainingSec} detik sebelum memakai ${mono(
            `${activePrefix}${cmd.name}`
          )} lagi ♡`,
        ]),
      },
      { quoted: msg }
    );
    return;
  }

  // 8. Eksekusi Command dengan reaksi otomatis ⏳ -> ✅ / ❌
  const startedAt = Date.now();
  await reactToMessage(sock, msg, config.theme.emojis.loading);

  const ctx = {
    sock,
    msg,
    chatJid,
    senderJid,
    senderNumber,
    pushName,
    isGroup,
    isOwner: senderIsOwner,
    isPremium: premiumInfo.isPremium,
    premiumInfo,
    isAdmin,
    isBotAdmin,
    groupMeta,
    prefix: activePrefix,
    commandName: invokedTrigger,
    args: tokens,
    text: rawArgsText,
    mentionedJids,
    contextInfo,
    quotedMessage,
    quotedSenderJid,
    getCachedGroupMetadata: (gJid = chatJid) => getCachedGroupMetadata(sock, gJid),
    getGroupAdminFlags: (gJid = chatJid, uJid = senderJid) =>
      getGroupAdminFlags(sock, gJid, uJid),
    invalidateGroupCache,
    commands,
    botStartTime,

    async reply(textContent, extra = {}) {
      return sock.sendMessage(
        chatJid,
        {
          text: smallcaps(textContent),
          mentions: extra.mentions || [],
        },
        { quoted: msg }
      );
    },

    async replyCard(cardBuffer, captionText, buttonOpts = {}) {
      return sendButtons(sock, chatJid, {
        title: buttonOpts.title || `❖ ${config.botName} ❖`,
        text: captionText,
        footer: buttonOpts.footer || config.footer,
        image: cardBuffer,
        buttons: buttonOpts.buttons || [],
        ownerJid: buttonOpts.ownerJid !== undefined ? buttonOpts.ownerJid : senderJid,
        isPublic: Boolean(buttonOpts.isPublic),
        oneTime: Boolean(buttonOpts.oneTime),
        mentions: buttonOpts.mentions || [],
        quoted: msg,
      });
    },
  };

  try {
    await cmd.execute(ctx);
    await reactToMessage(sock, msg, config.theme.emojis.success);
    for (const afterHook of hooks.onCommandSuccess) {
      try {
        await afterHook({
          sock,
          msg,
          chatJid,
          senderJid,
          pushName,
          isGroup,
          commandName: cmd.name,
          invokedTrigger,
          args: tokens,
        });
      } catch (hookErr) {
        logger.warn('HOOK', `Kesalahan pada onCommandSuccess hook: ${hookErr.message}`);
      }
    }
    logger.cmd({
      sender: senderNumber || senderJid,
      cmdName: `${activePrefix}${cmd.name}`,
      isGroup,
      status: 'OK',
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    await reactToMessage(sock, msg, config.theme.emojis.error);
    logger.error(`CMD:${cmd.name.toUpperCase()}`, 'Eksekusi command gagal', err);
    logger.cmd({
      sender: senderNumber || senderJid,
      cmdName: `${activePrefix}${cmd.name}`,
      isGroup,
      status: 'ERROR',
      ms: Date.now() - startedAt,
    });

    try {
      await sock.sendMessage(
        chatJid,
        {
          text: formatError('Ups, Ada Kendala Kecil', [
            `Maaf ya kak, fitur ${mono(`${activePrefix}${cmd.name}`)} sedang tersandung sedikit ♡`,
            'Tenang saja, sudah dicatat rapi di log untuk diperbaiki!',
          ]),
        },
        { quoted: msg }
      );
    } catch {
      // Abaikan bila koneksi terputus saat mengirim balasan error
    }
  }
}

/**
 * Minta nomor telepon via CLI bila dijalankan interaktif dan PAIRING_NUMBER belum diisi
 */
function promptPairingPhoneInteractive() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve('');
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      '✿ Masukkan nomor WhatsApp bot untuk Pairing Code (contoh 6281234567890): ',
      (answer) => {
        rl.close();
        resolve(String(answer || '').replace(/[^0-9]/g, ''));
      }
    );
  });
}

/**
 * Buka koneksi Baileys dengan login Pairing Code (tanpa QR) & Auto-Reconnect
 */
async function connectWhatsApp() {
  if (isShuttingDown) return null;

  fs.mkdirSync(config.paths.session, { recursive: true });

  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.makeWASocket || baileys.default;
  const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
  } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState(config.paths.session);

  let version = undefined;
  try {
    const versionInfo = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    if (versionInfo?.version) {
      version = versionInfo.version;
    }
  } catch {
    // Gunakan versi bawaan paket Baileys bila offline / dibatasi firewall panel
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: baileysLogger,
    printQRInTerminal: false, // WAJIB tanpa QR, khusus Pairing Code
    browser: Browsers ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  activeSock = sock;
  waConnectionStatus = sock.authState.creds.registered ? 'connecting' : 'pairing';
  sock.ev.on('creds.update', saveCreds);

  // Proses Pairing Code otomatis bila sesi belum terdaftar
  if (!sock.authState.creds.registered && !pairingRequested) {
    pairingRequested = true;
    setTimeout(async () => {
      try {
        const cliArg = process.argv.find((a) => a.startsWith('--pairing='));
        let phone = cliArg
          ? cliArg.split('=')[1].replace(/[^0-9]/g, '')
          : config.pairingNumber;

        if (!phone) {
          phone = await promptPairingPhoneInteractive();
        }

        if (!phone || phone.length < 8) {
          console.log(
            renderBox('ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ ᴅɪᴘᴇʀʟᴜᴋᴀɴ', [
              '✦ Sesi WhatsApp belum tertaut nih!',
              '✦ Isi PAIRING_NUMBER=628xxxxxxxxxx di dalam file .env',
              '✦ Lalu jalankan ulang bot untuk mendapatkan 8 digit kode pairing ♡',
            ])
          );
          pairingRequested = false;
          return;
        }

        const rawCode = await sock.requestPairingCode(phone);
        const formattedCode =
          rawCode && rawCode.length === 8
            ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`
            : rawCode;
        latestPairingCode = formattedCode;

        console.log('\n' +
          renderBox('ᴋᴏᴅᴇ ᴘᴀɪʀɪɴɢ ᴡʜᴀᴛsᴀᴘᴘ', [
            `✦ Nomor Bot   : +${keep(phone)}`,
            `✦ Kode Pairing: ${keep(formattedCode)}`,
            '◦ Buka WhatsApp > Perangkat Tertaut > Tautkan dengan Nomor Telepon',
            '◦ Masukkan kode di atas sebelum kedaluwarsa ya ♡',
          ]) + '\n'
        );
      } catch (err) {
        pairingRequested = false;
        logger.error('PAIRING', 'Gagal meminta kode pairing WhatsApp', err);
      }
    }, 2800);
  }

  // Pantau status koneksi & auto-reconnect eksponensial
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      reconnectAttempts = 0;
      pairingRequested = false;
      waConnectionStatus = 'online';
      latestPairingCode = null;
      const botUser = normalizeUserJid(sock.user?.id || '');
      logger.info('WA', `Terhubung ke WhatsApp sebagai ${botUser || config.botName} ♡`);

      for (const readyHook of hooks.onSocketReady) {
        try {
          await readyHook(sock);
        } catch (err) {
          logger.error('HOOK', 'Gagal menjalankan onSocketReady hook', err);
        }
      }
      return;
    }

    if (connection === 'close') {
      waConnectionStatus = 'offline';
      if (isShuttingDown) return;

      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reasonMsg = lastDisconnect?.error?.message || 'koneksi terputus';

      if (statusCode === DisconnectReason.loggedOut) {
        logger.error(
          'WA',
          'Sesi WhatsApp keluar (Logged Out / 401). Hapus isi folder ./session lalu jalankan ulang untuk pairing baru.'
        );
        return;
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        logger.warn(
          'WA',
          'Koneksi digantikan oleh sesi lain (440). Pastikan hanya 1 instance bot yang berjalan!'
        );
        return;
      }

      reconnectAttempts += 1;
      pairingRequested = false;
      const delayMs = Math.min(30000, 2000 * Math.pow(1.6, Math.min(reconnectAttempts, 6)));

      logger.warn(
        'WA',
        `Koneksi terputus (kode: ${statusCode || 'unknown'} — ${reasonMsg}). Menyambung ulang dalam ${(
          delayMs / 1000
        ).toFixed(1)} detik (percobaan #${reconnectAttempts})...`
      );

      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connectWhatsApp().catch((err) => logger.error('WA', 'Auto-reconnect gagal', err));
      }, delayMs);
    }
  });

  // Handler pesan baru
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !Array.isArray(messages)) return;
    for (const msg of messages) {
      handleIncomingMessage(sock, msg).catch((err) =>
        logger.error('MSG', 'Kesalahan tak terduga pada pemroses pesan', err)
      );
    }
  });

  // Panen pasangan @lid <-> @s.whatsapp.net dari sinkronisasi kontak Baileys v7
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts || []) {
      harvestLidMappingFromParticipant(c);
    }
  });
  sock.ev.on('contacts.update', (contacts) => {
    for (const c of contacts || []) {
      harvestLidMappingFromParticipant(c);
    }
  });

  // Segarkan cache grup saat ada perubahan anggota/info
  sock.ev.on('groups.update', (updates) => {
    for (const u of updates || []) {
      if (u?.id) groupMetaCache.delete(u.id);
    }
  });

  sock.ev.on('group-participants.update', async (event) => {
    if (event?.id) groupMetaCache.delete(event.id);
    if (Array.isArray(event?.participants)) {
      for (const p of event.participants) {
        if (p && typeof p === 'object') harvestLidMappingFromParticipant(p);
      }
    }
    for (const fn of hooks.onGroupParticipantsUpdate) {
      try {
        await fn(sock, event);
      } catch (err) {
        logger.error('HOOK', 'Kesalahan pada group-participants.update hook', err);
      }
    }
  });

  return sock;
}

let featureModulesLoaded = false;

/**
 * Muat modul fitur lintas fase di lib/ secara otomatis & idempoten bila tersedia
 */
function loadFeatureModules() {
  if (featureModulesLoaded) return;
  featureModulesLoaded = true;

  const optionalModules = [
    'group-guard.js',
    'leveling.js',
    'bridge.js',
    'discord.js',
    'scheduler.js',
    'kawaii.js',
  ];

  for (const fileName of optionalModules) {
    const modPath = path.join(__dirname, 'lib', fileName);
    if (!fs.existsSync(modPath)) continue;
    try {
      const mod = require(modPath);
      if (mod && typeof mod.register === 'function') {
        mod.register({
          registerHook,
          getCachedGroupMetadata,
          getGroupAdminFlags,
          invalidateGroupCache,
        });
      }
    } catch (err) {
      logger.error('MODULE', `Gagal memuat modul fitur ${fileName}`, err);
    }
  }
}

function getPidLockFilePath() {
  return path.join(config.paths.databaseDir, '.bot-instance.pid');
}

function acquireSingleInstanceLock() {
  try {
    fs.mkdirSync(config.paths.databaseDir, { recursive: true });
    const lockFile = getPidLockFilePath();
    if (fs.existsSync(lockFile)) {
      const existingPid = Number(String(fs.readFileSync(lockFile, 'utf8') || '').trim());
      if (Number.isInteger(existingPid) && existingPid > 0 && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          console.error(
            formatWarning('Bot Sudah Berjalan di Background', [
              `✦ PID Aktif : ${existingPid} (PM2)`,
              `✦ Jangan jalankan ${mono('npm start')} saat PM2 sedang aktif agar sesi WhatsApp & Pterodactyl tidak tabrakan!`,
              `◦ Ketik ${mono('pm2 logs cipismp-wa-bot')} untuk memantau log atau ${mono('pm2 restart cipismp-wa-bot')} untuk restart.`,
            ])
          );
          process.exit(1);
        } catch {
          // Proses lama sudah mati, timpa lockfile dengan aman
        }
      }
    }
    fs.writeFileSync(lockFile, String(process.pid), 'utf8');
  } catch {
    // Abaikan bila direktori tidak dapat ditulis
  }
}

function releaseSingleInstanceLock() {
  try {
    const lockFile = getPidLockFilePath();
    if (fs.existsSync(lockFile)) {
      const pidInFile = Number(String(fs.readFileSync(lockFile, 'utf8') || '').trim());
      if (pidInFile === process.pid) {
        fs.unlinkSync(lockFile);
      }
    }
  } catch {
    // Abaikan
  }
}

/**
 * Bootstrap aplikasi utama
 */
async function startBot() {
  if (require.main === module) {
    acquireSingleInstanceLock();
  }

  console.log(
    renderBox(`${config.botName} • Kawaii Bot 24/7`, [
      `✦ Prefix      : ${keep(config.prefix)}`,
      `✦ Zona Waktu  : ${keep(config.timezone)}`,
      `✦ Tombol UI   : ${config.useButtons ? 'Aktif (dengan Fallback)' : 'Nonaktif (Mode Teks)'}`,
      `✦ Mode DryRun : ${config.dryRun ? 'Aktif (Simulasi)' : 'Nonaktif (Live)'}`,
    ])
  );

  await initDatabase();
  loadCommands();
  loadFeatureModules();
  await startBackupScheduler();

  if (config.panel.enabled) {
    attachBotRuntimeToPanel({
      getSock: () => activeSock,
      getWaState: () => ({
        status: waConnectionStatus,
        botJid: activeSock?.user?.id ? normalizeUserJid(activeSock.user.id) : null,
        pairingCode: latestPairingCode,
      }),
      connectWa: async () => {
        if (!activeSock || waConnectionStatus === 'offline') {
          await connectWhatsApp();
        }
      },
      disconnectWa: async () => {
        try {
          if (activeSock?.ws && typeof activeSock.ws.close === 'function') {
            activeSock.ws.close();
          }
          waConnectionStatus = 'offline';
        } catch {
          // Abaikan
        }
      },
      requestPairing: async (phone) => {
        if (!activeSock || typeof activeSock.requestPairingCode !== 'function') {
          return { ok: false, error: 'Socket WhatsApp belum siap, tunggu beberapa detik lalu coba lagi.' };
        }
        if (activeSock.authState?.creds?.registered) {
          return { ok: false, error: 'Sesi WhatsApp sudah tertaut aktif.' };
        }
        try {
          const raw = await activeSock.requestPairingCode(phone);
          const formatted = raw && raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
          latestPairingCode = formatted;
          return { ok: true, pairingCode: formatted, phone };
        } catch (err) {
          return { ok: false, error: err.message || 'Gagal meminta kode pairing.' };
        }
      },
      reloadCommands: () => {
        loadCommands();
        return { commandsCount: commands.size, aliasesCount: aliases.size };
      },
      getCommandsInfo: () => ({
        commandsCount: commands.size,
        aliasesCount: aliases.size,
      }),
      getCommandsCatalog,
    });

    await startControlPanelServer().catch((err) =>
      logger.error('PANEL', 'Cipi Panel gagal dijalankan, bot tetap lanjut berjalan', err)
    );
  }

  await connectWhatsApp();
}

/**
 * Shutdown bersih saat menerima sinyal berhenti dari PM2 / Panel
 */
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('SYSTEM', `Menerima sinyal ${signal}, menutup bot dengan rapi...`);

  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopBackupScheduler();
  stopControlPanelServer().catch(() => {});

  try {
    if (activeSock?.ws && typeof activeSock.ws.close === 'function') {
      activeSock.ws.close();
    }
  } catch {
    // Abaikan penutupan ws
  }

  closeDatabase();
  releaseSingleInstanceLock();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('PROCESS', 'Unhandled Promise Rejection tertangkap aman', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('PROCESS', 'Uncaught Exception tertangkap aman', err);
});

// Jalankan otomatis bila dipanggil langsung (`node index.js`), tetap bisa di-import untuk uji modul
if (require.main === module) {
  startBot().catch((err) => {
    logger.error('STARTUP', 'Gagal menyalakan bot pada tahap awal', err);
    process.exit(1);
  });
}

module.exports = {
  startBot,
  connectWhatsApp,
  loadCommands,
  getCommandsCatalog,
  loadFeatureModules,
  resolveCommand,
  handleIncomingMessage,
  registerHook,
  getCachedGroupMetadata,
  getGroupAdminFlags,
  invalidateGroupCache,
  commands,
  aliases,
};
