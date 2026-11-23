const config = require('../config');
const {
  getDb,
  ensureGroup,
  ensureUser,
  normalizeUserJid,
  extractPhoneFromJid,
  isOwner,
  addAuditLog,
} = require('./database');
const { renderWelcomeLeaveCard } = require('./card');
const { renderBox, formatError, keep, mono } = require('./smallcaps');
const { logger } = require('./logger');

// Penyimpanan memori ringan untuk deteksi anti-spam & cache invite code grup sendiri
const spamTracker = new Map();
const warnDebounce = new Map();
const ownInviteCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of spamTracker.entries()) {
    if (now - v.lastSeen > 30000) spamTracker.delete(k);
  }
  for (const [k, ts] of warnDebounce.entries()) {
    if (now - ts > 30000) warnDebounce.delete(k);
  }
  for (const [k, item] of ownInviteCache.entries()) {
    if (item.expiresAt <= now) ownInviteCache.delete(k);
  }
}, 60 * 1000).unref();

const WA_GROUP_INVITE_REGEX = /chat\.whatsapp\.com\/([A-Za-z0-9_-]{16,40})/i;
const GENERIC_LINK_REGEX =
  /(?:https?:\/\/[^\s]+|www\.[^\s]+|\b(?:chat\.whatsapp\.com|t\.me|telegram\.me|discord\.gg|bit\.ly|tinyurl\.com)\/[^\s]+)/i;

/**
 * Ambil kode invite grup ini sendiri agar tidak terkena false-positive antilink
 */
async function getOwnGroupInviteCode(sock, groupJid, isBotAdmin) {
  if (!isBotAdmin || typeof sock?.groupInviteCode !== 'function') return null;
  const cached = ownInviteCache.get(groupJid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.code;
  }
  try {
    const code = await sock.groupInviteCode(groupJid);
    ownInviteCache.set(groupJid, {
      code: code || null,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return code || null;
  } catch {
    return null;
  }
}

/**
 * Cek apakah teks mengandung tautan terlarang di grup yang mengaktifkan antilink
 */
async function detectDisallowedLink(sock, groupJid, text, isBotAdmin) {
  if (!text) return null;
  const match = GENERIC_LINK_REGEX.exec(text);
  if (!match) return null;

  const foundUrl = match[0];
  const lower = foundUrl.toLowerCase();

  // Izinkan tautan resmi komunitas yang diatur di config.js
  const officialUrls = [
    config.links.discord,
    config.links.waGroup,
    config.links.website,
    config.minecraft.host,
  ]
    .filter(Boolean)
    .map((u) => u.toLowerCase());

  for (const official of officialUrls) {
    if (official && lower.includes(official.replace(/^https?:\/\//, ''))) {
      return null;
    }
  }

  // Izinkan link invite grup itu sendiri bila bot adalah admin
  const waMatch = WA_GROUP_INVITE_REGEX.exec(text);
  if (waMatch) {
    const ownCode = await getOwnGroupInviteCode(sock, groupJid, isBotAdmin);
    if (ownCode && waMatch[1] === ownCode) {
      return null;
    }
    return { type: 'wa_invite', url: foundUrl };
  }

  return { type: 'external_link', url: foundUrl };
}

/**
 * Deteksi banjir pesan / spam beruntun oleh satu member di grup
 */
function detectSpamBurst(groupJid, senderJid, body) {
  const trimmed = String(body || '').trim();
  const activePrefix = config.prefix || '.';

  // Jangan hitung penggunaan command bot atau pesan kosong/stiker biasa sebagai banjir teks
  // (command sudah dijaga oleh sistem cooldown & rate-limit per fitur)
  if (!trimmed || trimmed.startsWith(activePrefix)) {
    return null;
  }

  const now = Date.now();
  const windowMs = Number(config.moderation?.spamWindowMs || 6000);
  const maxMessages = Number(config.moderation?.spamMaxMessages || 10);
  const dupMax = Number(config.moderation?.spamDuplicateMax || 5);

  const key = `${groupJid}:${senderJid}`;
  const state = spamTracker.get(key) || {
    timestamps: [],
    lastText: '',
    dupCount: 0,
    lastSeen: now,
  };

  state.timestamps = state.timestamps.filter((t) => now - t < windowMs);
  state.timestamps.push(now);

  const normalizedText = trimmed.toLowerCase();
  if (normalizedText && normalizedText === state.lastText && now - state.lastSeen < 10000) {
    state.dupCount += 1;
  } else {
    state.lastText = normalizedText;
    state.dupCount = 1;
  }
  state.lastSeen = now;
  spamTracker.set(key, state);

  if (state.timestamps.length > maxMessages) {
    return 'burst_flood';
  }
  // Abaikan balasan singkat wajar ("ok", "ya", "iya", "wkwk", "haha") agar tidak dianggap spam
  if (normalizedText.length >= 6 && state.dupCount >= dupMax) {
    return 'duplicate_flood';
  }
  return null;
}

/**
 * Buat handler pre-command untuk fitur Mute Grup, Antilink, dan Anti-Spam
 */
function createGroupPreCommandHandler({ getGroupAdminFlags }) {
  return async function handleGroupModeration({
    sock,
    msg,
    chatJid,
    senderJid,
    senderNumber,
    body,
    isGroup,
  }) {
    if (!isGroup || !chatJid) return null;

    const groupRow = ensureGroup(chatJid);
    if (!groupRow) return null;

    const isMuted = Boolean(groupRow.mute);
    const hasAntilink = Boolean(groupRow.antilink);
    const hasAntispam = Boolean(groupRow.antispam);

    if (!isMuted && !hasAntilink && !hasAntispam) {
      return null;
    }

    const senderIsOwner = isOwner(senderJid);
    if (senderIsOwner) return null;

    // Ambil status admin hanya jika salah satu fitur aktif
    const { isAdmin, isBotAdmin } = await getGroupAdminFlags(sock, chatJid, senderJid);
    if (isAdmin) {
      return null;
    }

    // 1. Cek Antilink
    if (hasAntilink && body) {
      const linkViolation = await detectDisallowedLink(sock, chatJid, body, isBotAdmin);
      if (linkViolation) {
        if (isBotAdmin) {
          try {
            await sock.sendMessage(chatJid, { delete: msg.key });
          } catch (err) {
            logger.warn('ANTILINK', `Gagal menghapus pesan tautan: ${err.message}`);
          }
        }

        const db = getDb();
        db.run('UPDATE users SET warnings = warnings + 1, updated_at = ? WHERE jid = ?', [
          Date.now(),
          senderJid,
        ]);
        const updatedUser = db.get('SELECT warnings FROM users WHERE jid = ?', [senderJid]);
        const warnCount = Number(updatedUser?.warnings || 1);

        const tag = senderNumber ? `@${senderNumber}` : 'kak';
        await sock.sendMessage(chatJid, {
          text: formatError('Antilink Grup Aktif', [
            `Eits ${tag}, dilarang mengirim tautan luar di grup ini ya ♡`,
            `Peringatan kamu saat ini: ${warnCount}x`,
            !isBotAdmin ? 'Catatan: jadikan bot Admin agar pesan tautan bisa dihapus otomatis.' : '',
          ].filter(Boolean)),
          mentions: [senderJid],
        });

        addAuditLog({
          level: 'warn',
          category: 'moderation',
          actorJid: senderJid,
          target: chatJid,
          action: 'antilink_triggered',
          details: { linkType: linkViolation.type, warnings: warnCount },
        });

        return { stopProcessing: true };
      }
    }

    // 2. Cek Anti-Spam
    if (hasAntispam) {
      const spamReason = detectSpamBurst(chatJid, senderJid, body);
      if (spamReason) {
        if (isBotAdmin) {
          try {
            await sock.sendMessage(chatJid, { delete: msg.key });
          } catch {
            // Abaikan bila gagal hapus
          }
        }

        const warnKey = `${chatJid}:${senderJid}`;
        const lastWarnAt = warnDebounce.get(warnKey) || 0;
        const warnCooldown = Number(config.moderation?.warnCooldownMs || 10000);

        if (Date.now() - lastWarnAt >= warnCooldown) {
          warnDebounce.set(warnKey, Date.now());
          const tag = senderNumber ? `@${senderNumber}` : 'kak';
          await sock.sendMessage(chatJid, {
            text: formatError('Anti-Spam Aktif', [
              `Pelan-pelan ngetiknya ya ${tag} ♡ Jangan spam supaya grup tetap nyaman!`,
            ]),
            mentions: [senderJid],
          });
        }

        return { stopProcessing: true };
      }
    }

    // 3. Cek Mute Bot di Grup (member biasa tidak bisa memicu command saat grup di-mute)
    if (isMuted && String(body || '').trim().startsWith(config.prefix || '.')) {
      return { stopProcessing: true };
    }

    return null;
  };
}

/**
 * Kirim kartu & pesan Welcome / Leave ke grup
 */
async function sendWelcomeOrLeaveCard(sock, {
  groupJid,
  participantJid,
  mode = 'welcome',
  groupMeta = null,
}) {
  const groupRow = ensureGroup(groupJid, groupMeta?.subject || '');
  if (!groupRow) return;

  const targetJid = normalizeUserJid(participantJid);
  const phone = extractPhoneFromJid(targetJid);
  const dbUser = ensureUser(targetJid);
  const displayName =
    dbUser?.name && dbUser.name !== 'Sahabat Cipi'
      ? dbUser.name
      : phone
      ? `+${phone}`
      : 'Petualang Baru';

  const groupName = groupMeta?.subject || groupRow.name || 'Grup CipiSMP';
  const memberCount = Array.isArray(groupMeta?.participants)
    ? groupMeta.participants.length
    : 1;

  // Ambil foto profil member (atau grup sebagai cadangan kedua, lalu default-avatar lokal)
  let avatarUrl = null;
  if (typeof sock?.profilePictureUrl === 'function') {
    try {
      avatarUrl = await Promise.race([
        sock.profilePictureUrl(targetJid, 'image'),
        new Promise((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);
    } catch {
      avatarUrl = null;
    }
  }

  const rawTemplate =
    mode === 'leave'
      ? groupRow.leave_text || 'Sampai jumpa @user, semoga kembali lagi ya ✿'
      : groupRow.welcome_text || 'Selamat datang @user di @group ♡ Semoga betah ya!';

  const mentionTag = phone ? `@${phone}` : keep(displayName);
  const expandedText = rawTemplate
    .replace(/@user/gi, mentionTag)
    .replace(/@group/gi, keep(groupName))
    .replace(/@count/gi, String(memberCount));

  const caption = renderBox(
    mode === 'leave' ? '❖ sᴀᴍᴘᴀɪ ᴊᴜᴍᴘᴀ ✿' : '✿ sᴇʟᴀᴍᴀᴛ ᴅᴀᴛᴀɴɢ ♡',
    [
      `✦ ${expandedText}`,
      `◦ Grup    : ${keep(groupName)}`,
      `◦ Anggota : #${memberCount} petualang`,
      mode === 'welcome' ? `◦ Ketik ${mono(`${config.prefix}menu`)} untuk kenalan denganku ya!` : '',
    ].filter(Boolean),
    { footer: config.footer }
  );

  let cardBuffer = null;
  try {
    cardBuffer = await renderWelcomeLeaveCard({
      mode,
      userName: displayName,
      userPhone: phone,
      groupName,
      memberCount,
      avatarUrl,
    });
  } catch (err) {
    logger.error('WELCOME', 'Gagal merender kartu welcome/leave, memakai fallback teks', err);
  }

  if (cardBuffer) {
    await sock.sendMessage(groupJid, {
      image: cardBuffer,
      caption,
      mentions: [targetJid],
    });
  } else {
    await sock.sendMessage(groupJid, {
      text: caption,
      mentions: [targetJid],
    });
  }
}

/**
 * Handler event group-participants.update dari Baileys
 */
function createGroupParticipantsHandler({ getCachedGroupMetadata }) {
  return async function onGroupParticipantsUpdate(sock, event) {
    if (!event || !event.id || !Array.isArray(event.participants)) return;
    const { id: groupJid, action, participants } = event;
    if (action !== 'add' && action !== 'remove') return;

    const groupRow = ensureGroup(groupJid);
    if (!groupRow || !groupRow.welcome_enabled) return;

    const botJid = normalizeUserJid(sock?.user?.id || '');
    const meta = await getCachedGroupMetadata(sock, groupJid);

    for (const rawParticipant of participants) {
      const pJid = normalizeUserJid(
        typeof rawParticipant === 'string'
          ? rawParticipant
          : rawParticipant?.phoneNumber || rawParticipant?.id || ''
      );
      if (!pJid || pJid === botJid) continue;

      try {
        await sendWelcomeOrLeaveCard(sock, {
          groupJid,
          participantJid: pJid,
          mode: action === 'add' ? 'welcome' : 'leave',
          groupMeta: meta,
        });
      } catch (err) {
        logger.error('WELCOME', `Gagal mengirim pesan ${action} di ${groupJid}`, err);
      }
    }
  };
}

/**
 * Helper bersama untuk menentukan target member dari @mention, balasan pesan, atau nomor telepon
 */
function resolveTargetParticipant(ctx) {
  if (ctx.mentionedJids && ctx.mentionedJids.length > 0) {
    return normalizeUserJid(ctx.mentionedJids[0]);
  }
  if (ctx.quotedSenderJid) {
    return normalizeUserJid(ctx.quotedSenderJid);
  }
  if (ctx.args && ctx.args[0]) {
    const digits = String(ctx.args[0]).replace(/[^0-9]/g, '');
    if (digits.length >= 8) {
      return `${digits}@s.whatsapp.net`;
    }
  }
  return null;
}

function register(helpers) {
  helpers.registerHook('onMessagePreCommand', createGroupPreCommandHandler(helpers));
  helpers.registerHook('onGroupParticipantsUpdate', createGroupParticipantsHandler(helpers));
  logger.info('GROUP', 'Modul moderasi grup (Welcome/Leave, Antilink, Anti-Spam, Mute) aktif');
}

module.exports = {
  detectDisallowedLink,
  detectSpamBurst,
  sendWelcomeOrLeaveCard,
  resolveTargetParticipant,
  register,
};
