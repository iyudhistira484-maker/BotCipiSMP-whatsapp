const config = require('../../config');
const { isOwner } = require('../../lib/database');
const { setBotAccessMode } = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'public',
  alias: ['publik', 'modepublic'],
  category: 'owner',
  description: 'Ubah bot kembali ke Mode Public (merespons seluruh member)',
  cooldown: 2,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    setBotAccessMode({ actorJid: senderJid, mode: 'public' });

    await sendButtons(sock, chatJid, {
      title: '❖ Mode Public Aktif ❖',
      text: formatSuccess('Mode Public Diaktifkan! 🌸', [
        `✦ Sekarang seluruh warga CipiSMP dapat kembali memakai fitur ${config.botName}!`,
        `◦ Gunakan ${mono(`${prefix}self`)} atau ${mono(`${prefix}maintenance on`)} bila ingin membatasi sementara.`,
      ]),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}menu`, text: '📖 Buka Menu' },
        { id: `${prefix}logs`, text: '📊 Panel Status Bot' },
      ],
    });
  },
};
