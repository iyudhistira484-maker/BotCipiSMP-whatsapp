const config = require('../../config');
const {
  extractTargetMedia,
  downloadMediaBuffer,
  stickerToImage,
} = require('../../lib/sticker');
const { formatSuccess, formatError, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'toimg',
  alias: ['toimage', 'topng'],
  category: 'tools',
  description: 'Ubah stiker WhatsApp kembali menjadi gambar PNG jernih',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, quotedMessage, contextInfo } = ctx;
    const p = config.prefix;

    const media = extractTargetMedia(msg, quotedMessage, contextInfo);
    if (!media || media.kind !== 'sticker') {
      await ctx.reply(
        formatError('Balas Stiker Dulu Yuk', [
          `Balas (reply) sebuah stiker dengan ketik ${mono(`${p}toimg`)} untuk mengubahnya jadi foto ya kak ♡`,
        ])
      );
      return;
    }

    try {
      const webpBuffer = await downloadMediaBuffer(sock, media);
      const pngBuffer = await stickerToImage(webpBuffer);

      await sock.sendMessage(
        chatJid,
        {
          image: pngBuffer,
          caption: formatSuccess('Stiker Jadi Gambar', [
            'Ini dia hasil gambarnya kak ♡',
          ]),
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:TOIMG', 'Gagal mengubah stiker ke gambar', err);
      await ctx.reply(
        formatError('Konversi Gagal', [
          'Maaf kak, stiker ini belum berhasil dikonversi menjadi gambar.',
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
