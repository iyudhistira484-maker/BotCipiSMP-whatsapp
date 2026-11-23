const config = require('../../config');
const { isOwner } = require('../../lib/database');
const { setBotAccessMode } = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'self',
  alias: ['modeself', 'privatebot'],
  category: 'owner',
  description: 'Ubah bot ke Mode Self (hanya merespons command dari Owner)',
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

    setBotAccessMode({ actorJid: senderJid, mode: 'self' });

    await sendButtons(sock, chatJid, {
      title: '❖ Mode Self Aktif ❖',
      text: formatSuccess('Mode Self Diaktifkan 🤫', [
        `✦ Sekarang ${config.botName} hanya merespons command dari Owner.`,
        '✦ Pesan command dari member lain akan diabaikan secara hening.',
        `◦ Kembalikan ke publik kapan saja dengan ${mono(`${prefix}public`)}!`,
      ]),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}public`, text: '🌐 Kembalikan ke Public' },
        { id: `${prefix}logs`, text: '📊 Panel Status Bot' },
      ],
    });
  },
};
