const config = require('../../config');
const { isOwner, extractPhoneFromJid } = require('../../lib/database');
const { listBannedUsers, formatTimestampWib } = require('../../lib/owner-manager');
const { renderBox, formatError, keep, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'banlist',
  alias: ['listban', 'daftarban'],
  category: 'owner',
  description: 'Lihat daftar seluruh user yang sedang di-ban beserta alasannya (Khusus Owner)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const rows = listBannedUsers();
    if (rows.length === 0) {
      return reply(
        renderBox(
          '📋 ᴅᴀꜰᴛᴀʀ ᴜsᴇʀ ᴅɪ-ʙᴀɴ',
          [
            '✦ Tidak ada user yang sedang di-ban saat ini.',
            '◦ Seluruh warga CipiSMP tertib dan ceria! 🌸',
          ],
          { footer: config.footer }
        )
      );
    }

    const lines = [`✦ Total Dibatasi : ${rows.length} User`, ''];
    rows.slice(0, 25).forEach((u, idx) => {
      const phone = u.phone || extractPhoneFromJid(u.jid);
      lines.push(
        `❖ ${idx + 1}. ${keep(u.name)} (${mono(phone)})`,
        `  ◦ Alasan : ${keep(u.ban_reason || '-')}`,
        `  ◦ Waktu  : ${keep(formatTimestampWib(u.updated_at))}`
      );
    });

    if (rows.length > 25) {
      lines.push('', `◦ ...dan ${rows.length - 25} user lainnya.`);
    }
    lines.push('', `◦ Pulihkan akses: ${mono(`${prefix}unban <nomor>`)}`);

    return reply(
      renderBox('📋 ᴅᴀꜰᴛᴀʀ ᴜsᴇʀ ᴅɪ-ʙᴀɴ', lines, { footer: config.footer })
    );
  },
};
