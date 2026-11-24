const config = require('../../config');
const { renderBratSticker } = require('../../lib/sticker');
const { formatError, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

const BRAT_THEMES = new Set(['putih', 'white', 'hijau', 'lime', 'green', 'hitam', 'dark', 'black', 'pink', 'sakura']);

function extractQuotedText(quotedMessage) {
  if (!quotedMessage) return '';
  return String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      ''
  ).trim();
}

module.exports = {
  name: 'brat',
  alias: ['sbrat', 'bratstiker'],
  category: 'tools',
  description: 'Buat stiker teks bergaya Brat (putih, hijau, hitam, atau pink)',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, pushName, args, text, quotedMessage } = ctx;
    const p = config.prefix || '.';

    let theme = 'white';
    let rawBody = String(text || '').trim();

    if (args.length >= 1 && BRAT_THEMES.has(String(args[0] || '').toLowerCase())) {
      const rest = rawBody.slice(args[0].length).trim();
      if (rest || quotedMessage) {
        theme = String(args[0]).toLowerCase();
        rawBody = rest;
      }
    }

    const finalText = rawBody || extractQuotedText(quotedMessage);
    if (!finalText) {
      await ctx.reply(
        formatError('Teks Belum Diisi', [
          `Ketik ${mono(`${p}brat <teks>`)} atau reply pesan dengan ${mono(`${p}brat`)}.`,
          `Warna opsional: ${mono(`${p}brat hijau <teks>`)}, ${mono(`${p}brat hitam <teks>`)}, atau ${mono(`${p}brat pink <teks>`)}.`,
        ])
      );
      return;
    }

    try {
      const stickerBuf = await renderBratSticker({
        text: finalText,
        theme,
        packName: config.sticker?.packName || config.botName,
        author: config.sticker?.author || pushName || config.ownerName,
      });

      await sock.sendMessage(
        chatJid,
        { sticker: stickerBuf },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:BRAT', 'Gagal merender stiker .brat', err);
      await ctx.reply(
        formatError('Gagal Membuat Stiker Brat', [
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
