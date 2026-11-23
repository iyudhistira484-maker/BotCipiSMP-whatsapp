const config = require('../../config');
const { normalizeUserJid } = require('../../lib/database');
const { formatError, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'hidetag',
  alias: ['ht', 'pengumuman'],
  category: 'group',
  description: 'Kirim pengumuman dengan menandai seluruh anggota grup secara tersembunyi',
  cooldown: 8,
  groupOnly: true,
  adminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, text, quotedMessage, getCachedGroupMetadata } = ctx;
    const p = config.prefix;

    const quotedText =
      quotedMessage?.conversation ||
      quotedMessage?.extendedTextMessage?.text ||
      quotedMessage?.imageMessage?.caption ||
      quotedMessage?.videoMessage?.caption ||
      '';

    const contentText = (text || quotedText || '').trim();
    if (!contentText) {
      await ctx.reply(
        formatError('Pesan Kosong', [
          `Ketik pesan atau balas sebuah pesan lalu ketik ${mono(`${p}hidetag <pesan>`)} ya kak ♡`,
        ])
      );
      return;
    }

    const meta = await getCachedGroupMetadata(chatJid);
    if (!meta || !Array.isArray(meta.participants)) {
      await ctx.reply(
        formatError('Gagal Membaca Grup', [
          'Data peserta grup belum berhasil diambil, coba sebentar lagi ya ♡',
        ])
      );
      return;
    }

    const mentions = meta.participants
      .map((item) => normalizeUserJid(item.jid || item.phoneNumber || item.id || ''))
      .filter(Boolean);

    await sock.sendMessage(
      chatJid,
      {
        text: contentText,
        mentions,
      },
      { quoted: msg }
    );
  },
};
