const config = require('../../config');
const { joinGiveaway } = require('../../lib/scheduler');
const { formatSuccess, formatError, mono, keep } = require('../../lib/smallcaps');
const { getWibParts, formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'ikut',
  alias: ['join', 'ikutgw', 'joingw'],
  category: 'community',
  description: 'Daftar menjadi peserta Giveaway yang sedang berlangsung',
  cooldown: 3,
  groupOnly: true,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, chatJid, args } = ctx;
    const p = config.prefix;
    const codeArg = args[0] || '';

    const res = joinGiveaway(senderJid, chatJid, codeArg);
    if (!res.ok) {
      if (res.reason === 'already_joined') {
        await ctx.reply(
          formatError('Sudah Terdaftar', [
            `Nama kamu sudah masuk di daftar undian ${keep(res.code)} kok ♡`,
            `Total peserta saat ini: ${formatNumber(res.totalParticipants)} orang.`,
          ])
        );
        return;
      }
      if (res.reason === 'already_ended') {
        await ctx.reply(
          formatError('Giveaway Sudah Ditutup', [
            `Maaf kak, pendaftaran untuk ${keep(res.code)} baru saja berakhir ♡`,
          ])
        );
        return;
      }
      await ctx.reply(
        formatError('Belum Ada Giveaway Aktif', [
          `Saat ini belum ada sesi Giveaway aktif di grup ini ♡`,
          `Cek lewat ${mono(`${p}giveaway list`)} ya!`,
        ])
      );
      return;
    }

    const endWib = getWibParts(new Date(res.endsAt)).timestamp;
    await ctx.reply(
      formatSuccess(`Berhasil Ikut ${keep(res.code)}!`, [
        `✦ Hadiah       : ${keep(res.prize)}`,
        res.prizeAmount > 0
          ? `✦ Bonus Koin   : +${formatNumber(res.prizeAmount)} ${config.economy.currencyName}`
          : '',
        `✦ Peserta Ke   : #${formatNumber(res.totalParticipants)}`,
        `✦ Pengumuman   : ${keep(endWib)}`,
        '◦ Semoga beruntung ya kak! 🍀♡',
      ].filter(Boolean))
    );
  },
};
