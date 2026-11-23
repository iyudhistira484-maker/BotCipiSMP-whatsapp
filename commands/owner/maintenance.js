const config = require('../../config');
const { isOwner } = require('../../lib/database');
const {
  getBotOperationalState,
  setMaintenanceState,
} = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const {
  renderBox,
  formatSuccess,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'maintenance',
  alias: ['mt', 'perbaikan'],
  category: 'owner',
  description: 'Aktifkan atau matikan Mode Maintenance bot beserta pesan pemberitahuan kustom',
  cooldown: 2,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const sub = String(args[0] || '').toLowerCase().trim();

    if (sub === 'on' || sub === 'aktif' || sub === 'enable') {
      const customReason = args.slice(1).join(' ').trim();
      const res = setMaintenanceState({
        actorJid: senderJid,
        enabled: true,
        reason: customReason,
      });

      return sendButtons(sock, chatJid, {
        title: '❖ Mode Maintenance Aktif ❖',
        text: formatSuccess('Mode Maintenance Diaktifkan 🛠️', [
          '✦ Member reguler yang mengirim command akan menerima pesan perawatan.',
          `✦ Pesan Info : "${keep(res.reason)}"`,
          '✦ Owner tetap dapat menggunakan seluruh command seperti biasa.',
          `◦ Matikan kembali dengan ${mono(`${prefix}maintenance off`)}`,
        ]),
        footer: config.footer,
        ownerJid: senderJid,
        quoted: msg,
        buttons: [{ id: `${prefix}maintenance off`, text: '✅ Selesai Maintenance' }],
      });
    }

    if (sub === 'off' || sub === 'mati' || sub === 'disable') {
      setMaintenanceState({
        actorJid: senderJid,
        enabled: false,
      });

      return reply(
        formatSuccess('Mode Maintenance Dimatikan! 🌸', [
          `✦ Perawatan selesai! Seluruh fitur ${config.botName} kembali terbuka untuk member.`,
        ])
      );
    }

    const state = getBotOperationalState();
    return sendButtons(sock, chatJid, {
      title: '❖ Pengaturan Maintenance ❖',
      text: renderBox(
        '🛠️ sᴛᴀᴛᴜs ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ ʙᴏᴛ',
        [
          `✦ Status Saat Ini : ${state.maintenance ? '🟡 AKTIF (Maintenance)' : '🟢 NORMAL (Siap Melayani)'}`,
          `✦ Pesan Aktif     : "${keep(state.maintenanceReason)}"`,
          '',
          `◦ Aktifkan: ${mono(`${prefix}maintenance on Sedang update fitur baru ♡`)}`,
          `◦ Matikan : ${mono(`${prefix}maintenance off`)}`,
        ],
        { footer: config.footer }
      ),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        {
          id: state.maintenance
            ? `${prefix}maintenance off`
            : `${prefix}maintenance on Sedang pemeliharaan sebentar ya ♡`,
          text: state.maintenance ? '✅ Matikan Maintenance' : '🛠️ Aktifkan Maintenance',
        },
      ],
    });
  },
};
