const config = require('../../config');
const { doWork, formatCountdown } = require('../../lib/economy');
const { formatSuccess, formatError } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'kerja',
  alias: ['work', 'nyariuang'],
  category: 'economy',
  description: 'Bekerja paruh waktu di CipiSMP untuk mendapatkan Sakura Coin & XP',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName } = ctx;
    const res = doWork(senderJid, pushName);
    const cur = config.economy.currencyName;

    if (!res.ok) {
      await ctx.reply(
        formatError('Istirahat Dulu Yuk', [
          'Kamu baru saja selesai bekerja nih, minum teh hangat dulu sebentar ♡',
          `Bisa kerja lagi dalam: ${formatCountdown(res.remainingMs)}`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatSuccess(`Kerja: ${res.job.role}`, [
        `${res.job.story} ♡`,
        `Upah Kerja     : +${formatNumber(res.reward)} ${cur}${res.isPremium ? ' (VIP +25% ✦)' : ''}`,
        `Pengalaman     : +${res.xpGain} XP${res.xpResult?.leveledUp ? ` (Naik ke Lv.${res.xpResult.newLevel}!)` : ''}`,
        `Saldo Sekarang : ${formatNumber(res.newBalance)} ${cur}`,
      ])
    );
  },
};
