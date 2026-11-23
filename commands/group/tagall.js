const config = require('../../config');
const { normalizeUserJid, formatMentionTag, isOwner } = require('../../lib/database');
const { renderBox, formatError, mono, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'tagall',
  alias: ['everyone', 'mentionall', 'tag'],
  category: 'group',
  description: 'Panggil dan tandai seluruh anggota grup dalam daftar rapi (Khusus Owner)',
  cooldown: 10,
  groupOnly: true,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, text, getCachedGroupMetadata } = ctx;
    const p = config.prefix;

    if (!ctx.isOwner && !isOwner(senderJid)) {
      await ctx.reply(
        formatError('Khusus Owner', [
          `Command ${mono(`${p}tagall`)} hanya bisa dijalankan oleh Owner!`,
        ])
      );
      return;
    }

    const meta = await getCachedGroupMetadata(chatJid);
    if (!meta || !Array.isArray(meta.participants) || meta.participants.length === 0) {
      await ctx.reply(
        formatError('Gagal Mengambil Anggota', [
          'Daftar anggota grup belum terbaca, coba beberapa detik lagi.',
        ])
      );
      return;
    }

    const mentions = [];
    const memberLines = [];

    for (const participant of meta.participants) {
      const jid = normalizeUserJid(participant.jid || participant.phoneNumber || participant.id || '');
      if (!jid) continue;
      mentions.push(jid);
      memberLines.push(`• ${formatMentionTag(jid)}`);
    }

    const announcement = text ? keep(text) : 'Kumpul dulu yuk semuanya';
    const boxText = renderBox(
      `Panggilan Grup (${mentions.length})`,
      [
        `• Dari : ${keep(pushName)}`,
        `• Pesan : ${announcement}`,
        '',
        ...memberLines,
      ]
    );

    await sock.sendMessage(
      chatJid,
      {
        text: boxText,
        mentions,
      },
      { quoted: msg }
    );
  },
};
