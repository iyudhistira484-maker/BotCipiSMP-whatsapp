const config = require('../../config');
const { normalizeUserJid, extractPhoneFromJid } = require('../../lib/database');
const { renderBox, formatError, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'tagall',
  alias: ['everyone', 'mentionall'],
  category: 'group',
  description: 'Panggil dan tandai seluruh anggota grup dalam daftar rapi',
  cooldown: 10,
  groupOnly: true,
  adminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, pushName, text, getCachedGroupMetadata } = ctx;
    const meta = await getCachedGroupMetadata(chatJid);

    if (!meta || !Array.isArray(meta.participants) || meta.participants.length === 0) {
      await ctx.reply(
        formatError('Gagal Mengambil Anggota', [
          'Daftar anggota grup belum terbaca nih, coba beberapa detik lagi ya ♡',
        ])
      );
      return;
    }

    const mentions = [];
    const memberLines = [];

    for (const p of meta.participants) {
      const jid = normalizeUserJid(p.jid || p.phoneNumber || p.id || '');
      if (!jid) continue;
      mentions.push(jid);
      const num = extractPhoneFromJid(jid) || jid.split('@')[0];
      memberLines.push(`◦ @${num}`);
    }

    const announcement = text ? keep(text) : 'Kumpul dulu yuk semuanya ♡';
    const boxText = renderBox(
      `✿ ᴘᴀɴɢɢɪʟᴀɴ ɢʀᴜᴘ (${mentions.length})`,
      [
        `✦ Dari  : ${keep(pushName)}`,
        `✦ Pesan : ${announcement}`,
        '',
        ...memberLines,
      ],
      { footer: config.footer }
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
