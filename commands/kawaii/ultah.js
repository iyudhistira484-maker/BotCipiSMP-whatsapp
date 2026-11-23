const config = require('../../config');
const { ensureUser, extractPhoneFromJid } = require('../../lib/database');
const {
  formatMmDdHuman,
  setUserBirthday,
  clearUserBirthday,
  listUpcomingBirthdays,
} = require('../../lib/kawaii');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'ultah',
  alias: ['birthday', 'bday', 'ulangtahun'],
  category: 'kawaii',
  description: 'Catat tanggal ulang tahunmu & lihat daftar ultah warga CipiSMP terdekat',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, args, prefix, reply } = ctx;
    const sub = String(args[0] || '').toLowerCase().trim();

    // 1. Atur tanggal ulang tahun (.ultah set DD-MM atau langsung .ultah 14-02)
    if (sub === 'set' || sub === 'atur' || /^\d{1,2}[-/.]\d{1,2}/.test(sub)) {
      const dateRaw = sub === 'set' || sub === 'atur' ? args[1] : sub;
      const res = setUserBirthday(senderJid, dateRaw);
      if (!res.ok) {
        return reply(
          formatWarning('Format Tanggal Belum Tepat', [
            `✦ Gunakan format Tanggal-Bulan (DD-MM).`,
            `✦ Contoh: ${mono(`${prefix}ultah set 14-02`)} (untuk 14 Februari).`,
          ])
        );
      }

      return reply(
        formatSuccess('Tanggal Ulang Tahun Tersimpan! 🎂', [
          `✦ Tanggal Ultahmu : ${keep(res.humanLabel)}`,
          `✦ Setiap tanggal tersebut pukul 08:05 WIB, bot akan mengirim ucapan spesial & kado +1.000 ${config.economy.currencyName}! 🌸`,
        ])
      );
    }

    // 2. Hapus tanggal ulang tahun (.ultah hapus)
    if (sub === 'hapus' || sub === 'reset' || sub === 'delete') {
      clearUserBirthday(senderJid);
      return reply(
        formatSuccess('Data Ulang Tahun Dihapus', [
          `✦ Tanggal ulang tahunmu berhasil dihapus dari daftar pengingat.`,
        ])
      );
    }

    // 3. Lihat daftar ulang tahun terdekat (.ultah)
    const me = ensureUser(senderJid, pushName);
    const myBdayText = me?.birthday
      ? keep(formatMmDdHuman(me.birthday))
      : `Belum diatur (${mono(`${prefix}ultah set DD-MM`)})`;

    const upcoming = listUpcomingBirthdays(10);
    const lines = [
      `✦ Ultah Kamu : ${myBdayText}`,
      '',
      '❖ Daftar Ulang Tahun Terdekat:',
    ];

    if (upcoming.length === 0) {
      lines.push('  ◦ Belum ada member yang mencatat ulang tahun.');
    } else {
      for (const u of upcoming) {
        const tag = u.isToday ? '🎉 [HARI INI!]' : '';
        const phone = extractPhoneFromJid(u.jid);
        lines.push(
          `  ◦ ${keep(u.humanDate)} — ${keep(u.name || phone)} (Lv.${u.level}) ${tag}`
        );
      }
    }

    lines.push(
      '',
      `◦ Atur ultahmu: ${mono(`${prefix}ultah set 14-02`)} | Hapus: ${mono(`${prefix}ultah hapus`)}`
    );

    return reply(
      renderBox('🎂 ᴋᴀʟᴇɴᴅᴇʀ ᴜʟᴀɴɢ ᴛᴀʜᴜɴ ᴄɪᴘɪsᴍᴘ', lines, {
        footer: config.footer,
      })
    );
  },
};
