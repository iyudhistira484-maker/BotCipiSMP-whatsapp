const config = require('../../config');
const { isOwner } = require('../../lib/database');
const { listActivePremiumUsers } = require('../../lib/owner-manager');
const { renderBox, formatError, keep, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'listprem',
  alias: ['listvip', 'daftarvip', 'daftarprem'],
  category: 'owner',
  description: 'Lihat daftar seluruh member Sakura VIP yang aktif beserta masa berlakunya',
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

    const rows = listActivePremiumUsers();
    if (rows.length === 0) {
      return reply(
        renderBox(
          '👑 ᴅᴀꜰᴛᴀʀ ᴍᴇᴍʙᴇʀ sᴀᴋᴜʀᴀ ᴠɪᴘ',
          [
            '✦ Belum ada member Sakura VIP berdurasi yang aktif saat ini.',
            `◦ Tambahkan VIP baru dengan ${mono(`${prefix}addprem @user 30d`)}`,
          ],
          { footer: config.footer }
        )
      );
    }

    const lines = [`✦ Total Sakura VIP Aktif : ${rows.length} Member`, ''];
    rows.slice(0, 25).forEach((row, idx) => {
      lines.push(
        `❖ ${idx + 1}. ${keep(row.name)} (${mono(row.phone)}) — Lv.${row.level || 1}`,
        `  ◦ Sisa     : ${row.daysLeft} Hari (s/d ${keep(row.expiresWib)})`,
        ...(row.note ? [`  ◦ Catatan  : ${keep(row.note)}`] : [])
      );
    });

    if (rows.length > 25) {
      lines.push('', `◦ ...dan ${rows.length - 25} member VIP lainnya.`);
    }
    lines.push(
      '',
      `◦ Perpanjang: ${mono(`${prefix}addprem <nomor> 30d`)} | Cabut: ${mono(`${prefix}delprem <nomor>`)}`
    );

    return reply(
      renderBox('👑 ᴅᴀꜰᴛᴀʀ ᴍᴇᴍʙᴇʀ sᴀᴋᴜʀᴀ ᴠɪᴘ', lines, { footer: config.footer })
    );
  },
};
