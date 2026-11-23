const config = require('../../config');
const {
  extractTargetMedia,
  downloadMediaBuffer,
  attachStickerExif,
  imageToSticker,
  videoToSticker,
} = require('../../lib/sticker');
const { formatError, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'sticker',
  alias: ['s', 'stiker', 'sgif', 'swm'],
  category: 'tools',
  description: 'Ubah gambar atau video/GIF pendek menjadi stiker WhatsApp ber-EXIF',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, pushName, args, text, quotedMessage, contextInfo } = ctx;
    const p = config.prefix;

    const media = extractTargetMedia(msg, quotedMessage, contextInfo);
    if (!media) {
      await ctx.reply(
        formatError('Media Belum Ada', [
          `Kirim foto/video dengan caption ${mono(`${p}sticker`)} atau balas foto/video dengan ${mono(`${p}s`)} ya kak ♡`,
          `Tips: tambahkan ${mono('crop')} untuk stiker penuh, atau ${mono(`${p}s NamaPack | NamaAuthor`)}`,
        ])
      );
      return;
    }

    const wantCrop = args.some((a) => ['crop', 'full'].includes(a.toLowerCase()));
    const cleanMetaText = text
      .replace(/\b(crop|full)\b/gi, '')
      .trim();

    let packName = config.sticker.packName || config.botName;
    let author = config.sticker.author || pushName || config.ownerName;

    if (cleanMetaText.includes('|')) {
      const [customPack, customAuthor] = cleanMetaText.split('|').map((s) => s.trim());
      if (customPack) packName = customPack.slice(0, 40);
      if (customAuthor) author = customAuthor.slice(0, 40);
    } else if (cleanMetaText) {
      packName = cleanMetaText.slice(0, 40);
    }

    try {
      const mediaBuf = await downloadMediaBuffer(sock, media);
      let stickerBuffer;

      if (media.kind === 'video') {
        stickerBuffer = await videoToSticker(mediaBuf, {
          crop: wantCrop,
          packName,
          author,
        });
      } else if (media.kind === 'sticker') {
        stickerBuffer = await attachStickerExif(mediaBuf, { packName, author });
      } else {
        stickerBuffer = await imageToSticker(mediaBuf, {
          crop: wantCrop,
          packName,
          author,
        });
      }

      await sock.sendMessage(
        chatJid,
        {
          sticker: stickerBuffer,
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:STICKER', 'Gagal membuat stiker', err);
      await ctx.reply(
        formatError('Gagal Membuat Stiker', [
          'Maaf kak, media gagal diubah menjadi stiker nih ♡',
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
