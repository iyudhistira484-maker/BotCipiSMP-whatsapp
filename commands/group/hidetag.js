const config = require('../../config');
const { normalizeUserJid, isOwner } = require('../../lib/database');
const { formatError, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'hidetag',
  alias: ['ht', 'pengumuman', 'totag'],
  category: 'group',
  description: 'Kirim pengumuman dengan menandai seluruh anggota grup secara tersembunyi (Khusus Owner)',
  cooldown: 8,
  groupOnly: true,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, text, quotedMessage, getCachedGroupMetadata } = ctx;
    const p = config.prefix;

    if (!ctx.isOwner && !isOwner(senderJid)) {
      await ctx.reply(
        formatError('Khusus Owner', [
          `Command ${mono(`${p}hidetag`)} hanya bisa dijalankan oleh Owner!`,
        ])
      );
      return;
    }

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
          `Ketik pesan atau balas sebuah pesan lalu ketik ${mono(`${p}hidetag <pesan>`)}`,
        ])
      );
      return;
    }

    const meta = await getCachedGroupMetadata(chatJid);
    if (!meta || !Array.isArray(meta.participants)) {
      await ctx.reply(
        formatError('Gagal Membaca Grup', [
          'Data peserta grup belum berhasil diambil, coba sebentar lagi.',
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
