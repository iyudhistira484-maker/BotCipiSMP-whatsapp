const config = require('../../config');
const {
  normalizeUserJid,
  extractPhoneFromJid,
  getDb,
} = require('../../lib/database');
const { getVerifiedLinkByJid } = require('../../lib/bridge');
const { renderQuoteChatSticker } = require('../../lib/sticker');
const { fetchWithTimeout } = require('../../lib/api');
const { formatError, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

const QC_THEMES = new Set(['dark', 'gelap', 'hitam', 'putih', 'light', 'terang', 'pink', 'sakura']);

function extractQuotedPlainText(quotedMessage) {
  if (!quotedMessage) return '';
  return String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      quotedMessage.documentMessage?.caption ||
      ''
  ).trim();
}

function resolveDisplayNameForQc(targetJid, fallbackPushName = '') {
  const norm = normalizeUserJid(targetJid);
  if (fallbackPushName && fallbackPushName !== 'Sahabat Cipi') {
    return fallbackPushName;
  }
  try {
    const row = getDb().get('SELECT name FROM users WHERE jid = ?', [norm]);
    if (row?.name && row.name !== 'Sahabat Cipi') return row.name;
  } catch {
    // Abaikan
  }
  const link = getVerifiedLinkByJid(norm);
  if (link?.mc_username) return link.mc_username;
  const phone = extractPhoneFromJid(norm);
  return phone ? `+${phone}` : 'Member';
}

async function fetchUserProfilePhotoBuffer(sock, jid) {
  if (!sock || typeof sock.profilePictureUrl !== 'function' || config.dryRun) {
    return null;
  }
  try {
    const ppUrl = await Promise.race([
      sock.profilePictureUrl(jid, 'image'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3200)),
    ]);
    if (!ppUrl || !/^https?:\/\//i.test(ppUrl)) return null;
    const res = await fetchWithTimeout(ppUrl, { headers: { Accept: 'image/*' } }, 4000);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

module.exports = {
  name: 'qc',
  alias: ['quotechat', 'qchat', 'fakechat'],
  category: 'tools',
  description: 'Buat stiker bubble chat WhatsApp dari teks atau reply pesan teman',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      msg,
      chatJid,
      senderJid,
      pushName,
      args,
      text,
      quotedMessage,
      quotedSenderJid,
    } = ctx;
    const p = config.prefix || '.';

    let theme = 'dark';
    let bodyText = String(text || '').trim();

    if (args.length >= 1 && QC_THEMES.has(String(args[0] || '').toLowerCase())) {
      const candidateTheme = String(args[0]).toLowerCase();
      const rest = bodyText.slice(args[0].length).trim();
      if (rest || quotedMessage) {
        theme = candidateTheme;
        bodyText = rest;
      }
    }

    const quotedText = extractQuotedPlainText(quotedMessage);
    const finalText = bodyText || quotedText;

    if (!finalText) {
      await ctx.reply(
        formatError('Teks Belum Diisi', [
          `Ketik ${mono(`${p}qc <teks>`)} atau reply pesan teman dengan ${mono(`${p}qc`)}.`,
          `Tema opsional: ${mono(`${p}qc putih <teks>`)} atau ${mono(`${p}qc pink <teks>`)}.`,
        ])
      );
      return;
    }

    const isReplyingOther = Boolean(quotedSenderJid);
    const targetJid = isReplyingOther
      ? normalizeUserJid(quotedSenderJid)
      : normalizeUserJid(senderJid);
    const displayName = isReplyingOther
      ? resolveDisplayNameForQc(targetJid, '')
      : resolveDisplayNameForQc(targetJid, pushName);

    try {
      const avatarBuffer = await fetchUserProfilePhotoBuffer(sock, targetJid);
      const stickerBuf = await renderQuoteChatSticker({
        senderName: displayName,
        text: finalText,
        avatarBuffer,
        theme,
        packName: config.sticker?.packName || config.botName,
        author: config.sticker?.author || displayName,
      });

      await sock.sendMessage(
        chatJid,
        { sticker: stickerBuf },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:QC', 'Gagal merender stiker .qc', err);
      await ctx.reply(
        formatError('Gagal Membuat Stiker QC', [
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
