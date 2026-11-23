const config = require('../config');
const { getDb, normalizeUserJid, addAuditLog } = require('./database');
const { sendButtons } = require('./buttons');
const { sanitizeMinecraftText, sendMinecraftBroadcast } = require('./ptero');
const { sanitizeDiscordText, sendDiscordWebhookBroadcast } = require('./discord');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('./smallcaps');
const { logger } = require('./logger');

/**
 * Penyimpanan sesi konfirmasi tertunda milik Owner (berlaku 30 detik)
 * Dipakai oleh Broadcast (.bc/.bcmc/.bcdc/.bcall) & siap dipakai ulang oleh Kontrol Server (.stop/.restart)
 */
const pendingConfirmations = new Map();

let lastBroadcastExecutedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bersihkan sesi konfirmasi yang sudah lewat 30 detik
 */
function sweepExpiredConfirmations() {
  const now = Date.now();
  for (const [jid, entry] of pendingConfirmations.entries()) {
    if (entry.expiresAt <= now) {
      if (entry.timer) clearTimeout(entry.timer);
      pendingConfirmations.delete(jid);
    }
  }
}

/**
 * Daftarkan aksi sensitif yang wajib dikonfirmasi dalam N milidetik (default 30 detik)
 */
function registerPendingConfirmation(ownerRawJid, {
  kind = 'broadcast',
  label = 'Aksi Owner',
  expiresInMs = config.broadcast?.confirmTimeoutMs || 30000,
  onConfirm,
}) {
  sweepExpiredConfirmations();
  const ownerJid = normalizeUserJid(ownerRawJid);
  const existing = pendingConfirmations.get(ownerJid);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    pendingConfirmations.delete(ownerJid);
  }, expiresInMs);
  if (typeof timer.unref === 'function') timer.unref();

  const session = {
    ownerJid,
    kind,
    label,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInMs,
    onConfirm,
    timer,
  };
  pendingConfirmations.set(ownerJid, session);
  return session;
}

/**
 * Ambil & konsumsi sesi konfirmasi aktif milik Owner (.ya)
 */
function consumePendingConfirmation(ownerRawJid) {
  sweepExpiredConfirmations();
  const ownerJid = normalizeUserJid(ownerRawJid);
  const entry = pendingConfirmations.get(ownerJid);
  if (!entry) return null;
  if (entry.timer) clearTimeout(entry.timer);
  pendingConfirmations.delete(ownerJid);
  return entry;
}

/**
 * Batalkan sesi konfirmasi aktif milik Owner (.batal)
 */
function cancelPendingConfirmation(ownerRawJid) {
  sweepExpiredConfirmations();
  const ownerJid = normalizeUserJid(ownerRawJid);
  const entry = pendingConfirmations.get(ownerJid);
  if (!entry) return null;
  if (entry.timer) clearTimeout(entry.timer);
  pendingConfirmations.delete(ownerJid);
  return entry;
}

/**
 * Cek cooldown 60 detik khusus fitur Broadcast
 */
function checkBroadcastCooldown() {
  const cooldownMs = Number(config.broadcast?.cooldownMs || 60000);
  const elapsed = Date.now() - lastBroadcastExecutedAt;
  if (lastBroadcastExecutedAt > 0 && elapsed < cooldownMs) {
    return {
      allowed: false,
      remainingSec: Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)),
    };
  }
  return { allowed: true, remainingSec: 0 };
}

/**
 * Kumpulkan daftar seluruh JID grup WhatsApp tujuan broadcast
 */
async function collectWhatsAppGroupTargets(sock) {
  const groupSet = new Set();

  // 1. Dari database lokal groups
  const rows = getDb().all('SELECT jid FROM groups');
  for (const r of rows) {
    if (r?.jid && String(r.jid).endsWith('@g.us')) {
      groupSet.add(r.jid);
    }
  }

  // 2. Dari daftar grup aktif di socket Baileys bila tersedia
  if (typeof sock?.groupFetchAllParticipating === 'function') {
    try {
      const participating = await Promise.race([
        sock.groupFetchAllParticipating(),
        new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
      ]);
      if (participating && typeof participating === 'object') {
        for (const gJid of Object.keys(participating)) {
          if (gJid.endsWith('@g.us')) groupSet.add(gJid);
        }
      }
    } catch {
      // Gunakan daftar dari database lokal bila query live gagal
    }
  }

  return Array.from(groupSet);
}

/**
 * Sanitasi menyeluruh teks broadcast (maks 300 karakter, anti-injeksi MC & anti-@everyone DC)
 */
function sanitizeBroadcastInput(rawText = '') {
  const maxLen = Number(config.broadcast?.maxLength || 300);
  const trimmed = String(rawText || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  if (!trimmed) {
    return { valid: false, reason: 'empty' };
  }
  if (trimmed.length > maxLen) {
    return {
      valid: false,
      reason: 'too_long',
      length: trimmed.length,
      maxLen,
    };
  }

  const safeWaText = sanitizeDiscordText(trimmed, maxLen);
  const safeMcText = sanitizeMinecraftText(trimmed, maxLen);
  const safeDcText = sanitizeDiscordText(trimmed, maxLen);

  if (!safeMcText && !safeDcText) {
    return { valid: false, reason: 'empty_after_sanitize' };
  }

  return {
    valid: true,
    length: trimmed.length,
    maxLen,
    safeWaText,
    safeMcText,
    safeDcText,
  };
}

/**
 * Tentukan platform aktif berdasarkan mode ('wa' | 'mc' | 'dc' | 'all')
 */
function resolveTargetPlatforms(targetMode = 'all') {
  switch (targetMode) {
    case 'wa':
      return { wa: true, mc: false, dc: false, title: 'WhatsApp Semua Grup' };
    case 'mc':
      return { wa: false, mc: true, dc: false, title: 'Server Minecraft' };
    case 'dc':
      return { wa: false, mc: false, dc: true, title: 'Channel Discord' };
    case 'all':
    default:
      return {
        wa: true,
        mc: true,
        dc: true,
        title: 'Semua Platform (WA + Minecraft + Discord)',
      };
  }
}

/**
 * Eksekusi pengiriman broadcast ke seluruh platform yang dipilih & catat audit log
 */
async function executeConfirmedBroadcast({
  sock,
  senderJid,
  senderName,
  targetMode,
  sanitized,
}) {
  lastBroadcastExecutedAt = Date.now();
  const startedAt = Date.now();
  const targets = resolveTargetPlatforms(targetMode);
  const reportLines = [];
  const auditResults = {};

  if (config.dryRun) {
    reportLines.push('⚠️ Mode: DRY-RUN AKTIF (Simulasi — tidak benar-benar dikirim)');
  }

  // 1. Tujuan WhatsApp Grup
  if (targets.wa) {
    const groupJids = await collectWhatsAppGroupTargets(sock);
    if (config.dryRun) {
      reportLines.push(
        `✦ WhatsApp  : [DRY-RUN] Akan dikirim ke ${groupJids.length} grup`
      );
      auditResults.wa = { dryRun: true, targetCount: groupJids.length };
    } else if (groupJids.length === 0) {
      reportLines.push('✦ WhatsApp  : ⚠️ Belum ada grup terdaftar');
      auditResults.wa = { sent: 0, failed: 0 };
    } else {
      let okCount = 0;
      let failCount = 0;
      const delayMs = Number(config.cooldown?.broadcastDelayMs || 1200);
      const waPayloadText = renderBox(
        `✿ ᴘᴇɴɢᴜᴍᴜᴍᴀɴ ${config.botName}`,
        [
          `✦ ${keep(sanitized.safeWaText)}`,
          `◦ Pengirim: ${keep(senderName)}`,
        ],
        { footer: config.footer }
      );

      for (let i = 0; i < groupJids.length; i += 1) {
        try {
          await sock.sendMessage(groupJids[i], { text: waPayloadText });
          okCount += 1;
        } catch (err) {
          failCount += 1;
          logger.warn('BROADCAST:WA', `Gagal kirim ke ${groupJids[i]}: ${err.message}`);
        }
        if (i < groupJids.length - 1 && delayMs > 0) {
          await sleep(delayMs);
        }
      }

      reportLines.push(
        `✦ WhatsApp  : ✅ ${okCount} berhasil, ❌ ${failCount} gagal (total ${groupJids.length} grup)`
      );
      auditResults.wa = { sent: okCount, failed: failCount, total: groupJids.length };
    }
  }

  // 2. Tujuan Minecraft (Pterodactyl -> Fallback RCON)
  if (targets.mc) {
    const mcRes = await sendMinecraftBroadcast(sanitized.safeMcText, '✿ Pengumuman');
    if (mcRes.ok) {
      reportLines.push(
        `✦ Minecraft : ✅ Berhasil via ${keep(mcRes.via)}`
      );
    } else {
      reportLines.push(
        `✦ Minecraft : ❌ Gagal (${keep(mcRes.error || 'tidak terhubung')})`
      );
    }
    auditResults.mc = mcRes;
  }

  // 3. Tujuan Discord Webhook (Embed Pink + Thumbnail Anime)
  if (targets.dc) {
    const dcRes = await sendDiscordWebhookBroadcast({
      message: sanitized.safeDcText,
      senderLabel: senderName,
    });
    if (dcRes.ok) {
      reportLines.push(
        `✦ Discord   : ✅ Berhasil via ${keep(dcRes.via)}`
      );
    } else {
      reportLines.push(
        `✦ Discord   : ❌ Gagal (${keep(dcRes.error || 'webhook gagal')})`
      );
    }
    auditResults.dc = dcRes;
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  reportLines.push(`◦ Durasi    : ${durationSec} detik`);

  addAuditLog({
    level: 'info',
    category: 'broadcast',
    actorJid: senderJid,
    target: targetMode,
    action: config.dryRun ? 'broadcast_dryrun' : 'broadcast_sent',
    details: {
      senderName,
      length: sanitized.length,
      preview: sanitized.safeMcText.slice(0, 120),
      results: auditResults,
    },
  });

  return renderBox('✿ ʟᴀᴘᴏʀᴀɴ ʜᴀsɪʟ ʙʀᴏᴀᴅᴄᴀsᴛ', reportLines, {
    footer: config.footer,
  });
}

/**
 * Buat Preview Broadcast + Konfirmasi 30 Detik (.ya / .batal atau tombol)
 */
async function initiateBroadcastFlow(ctx, targetMode = 'all') {
  const { sock, msg, chatJid, senderJid, pushName, text } = ctx;
  const p = config.prefix;

  const cd = checkBroadcastCooldown();
  if (!cd.allowed) {
    await ctx.reply(
      formatError('Cooldown Broadcast Aktif', [
        `Tunggu ${cd.remainingSec} detik sebelum mengirim broadcast berikutnya ya kak ♡`,
      ])
    );
    return;
  }

  const sanitized = sanitizeBroadcastInput(text);
  if (!sanitized.valid) {
    if (sanitized.reason === 'too_long') {
      await ctx.reply(
        formatError('Pesan Terlalu Panjang', [
          `Panjang pesanmu ${sanitized.length} karakter (maksimal ${sanitized.maxLen} karakter) ♡`,
          'Ringkas sedikit pesannya yuk!',
        ])
      );
      return;
    }
    await ctx.reply(
      formatError('Pesan Broadcast Kosong', [
        `Ketik isi pengumuman setelah command, contoh: ${mono(`${p}${ctx.commandName} Halo semuanya! Event dimulai jam 19:00 WIB ♡`)}`,
      ])
    );
    return;
  }

  const targets = resolveTargetPlatforms(targetMode);
  const waGroups = targets.wa ? await collectWhatsAppGroupTargets(sock) : [];
  const destLabels = [];
  if (targets.wa) destLabels.push(`WhatsApp (${waGroups.length} grup)`);
  if (targets.mc) destLabels.push('Minecraft (Ptero/RCON)');
  if (targets.dc) destLabels.push('Discord (Webhook)');

  const senderLabel = pushName || config.ownerName;

  registerPendingConfirmation(senderJid, {
    kind: 'broadcast',
    label: `Broadcast ke ${targets.title}`,
    expiresInMs: config.broadcast?.confirmTimeoutMs || 30000,
    onConfirm: async (confirmCtx) => {
      const cdAgain = checkBroadcastCooldown();
      if (!cdAgain.allowed) {
        await confirmCtx.reply(
          formatError('Cooldown Broadcast Aktif', [
            `Tunggu ${cdAgain.remainingSec} detik lagi ya kak ♡`,
          ])
        );
        return;
      }

      const reportText = await executeConfirmedBroadcast({
        sock: confirmCtx.sock,
        senderJid: confirmCtx.senderJid,
        senderName: senderLabel,
        targetMode,
        sanitized,
      });

      await confirmCtx.sock.sendMessage(
        confirmCtx.chatJid,
        { text: reportText },
        { quoted: confirmCtx.msg }
      );
    },
  });

  const previewLines = [
    config.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF (tidak benar-benar dikirim)' : '',
    `✦ Tujuan    : ${destLabels.join(' + ')}`,
    `✦ Pengirim  : ${keep(senderLabel)}`,
    `✦ Karakter  : ${sanitized.length}/${sanitized.maxLen}`,
    `✦ Batas Konf: 30 detik`,
    '',
    '❖ Preview Pesan Tersanitasi:',
    `"${keep(sanitized.safeWaText)}"`,
    '',
    `◦ Ketik ${mono(`${p}ya`)} untuk mengirim atau ${mono(`${p}batal`)} untuk membatalkan ♡`,
  ].filter((l) => l !== '');

  const previewBox = renderBox('✿ ᴘʀᴇᴠɪᴇᴡ & ᴋᴏɴꜰɪʀᴍᴀsɪ ʙʀᴏᴀᴅᴄᴀsᴛ', previewLines, {
    footer: config.footer,
  });

  await sendButtons(sock, chatJid, {
    title: '❖ Konfirmasi Broadcast ❖',
    text: previewBox,
    footer: config.footer,
    ownerJid: senderJid,
    oneTime: true,
    ttlMs: config.broadcast?.confirmTimeoutMs || 30000,
    quoted: msg,
    buttons: [
      { command: `${p}ya`, text: '✅ Ya, Kirim', oneTime: true },
      { command: `${p}batal`, text: '❌ Batal', oneTime: true },
    ],
  });
}

/**
 * Reset cooldown broadcast (khusus pengujian unit otomatis)
 */
function resetBroadcastCooldownForTest() {
  lastBroadcastExecutedAt = 0;
}

module.exports = {
  registerPendingConfirmation,
  consumePendingConfirmation,
  cancelPendingConfirmation,
  checkBroadcastCooldown,
  sanitizeBroadcastInput,
  collectWhatsAppGroupTargets,
  executeConfirmedBroadcast,
  initiateBroadcastFlow,
  resetBroadcastCooldownForTest,
};
