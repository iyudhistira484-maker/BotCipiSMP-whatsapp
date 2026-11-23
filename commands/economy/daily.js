const config = require('../../config');
const { claimDaily, formatCountdown } = require('../../lib/economy');
const { formatSuccess, formatError } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'daily',
  alias: ['harian', 'klaimharian'],
  category: 'economy',
  description: 'Klaim hadiah Sakura Coin harian + bonus streak beruntun',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName } = ctx;
    const res = claimDaily(senderJid, pushName);
    const cur = config.economy.currencyName;

    if (!res.ok) {
      await ctx.reply(
        formatError('Daily Sudah Diklaim', [
          'Kamu sudah mengambil hadiah harian hari ini nih kak ♡',
          `Bisa klaim lagi dalam: ${formatCountdown(res.remainingMs)}`,
        ])
      );
      return;
    }

    const lines = [
      `Hadiah Diterima : +${formatNumber(res.reward)} ${cur}${res.isPremium ? ' (Bonus VIP +25% ✦)' : ''}`,
      res.streakBonus > 0 ? `Bonus Streak    : +${formatNumber(res.streakBonus)} ${cur} (Hari ke-${res.streak} 🔥)` : `Streak Saat Ini : Hari ke-${res.streak}`,
      `Bonus XP        : +${res.xpGain} XP${res.xpResult?.leveledUp ? ` (Naik ke Lv.${res.xpResult.newLevel}! 🎉)` : ''}`,
      `Saldo Sekarang  : ${formatNumber(res.newBalance)} ${cur}`,
    ];

    await ctx.reply(formatSuccess('Klaim Daily Berhasil', lines));
  },
};
