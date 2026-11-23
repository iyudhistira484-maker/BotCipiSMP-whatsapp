const config = require('../../config');
const { claimWeekly, formatCountdown } = require('../../lib/economy');
const { formatSuccess, formatError } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'weekly',
  alias: ['mingguan', 'klaimmingguan'],
  category: 'economy',
  description: 'Klaim peti hadiah besar Sakura Coin setiap 7 hari sekali',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName } = ctx;
    const res = claimWeekly(senderJid, pushName);
    const cur = config.economy.currencyName;

    if (!res.ok) {
      await ctx.reply(
        formatError('Weekly Belum Siap', [
          'Peti mingguanmu masih disiapkan sama kurir sakura nih ♡',
          `Tersedia lagi dalam: ${formatCountdown(res.remainingMs)}`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatSuccess('Peti Mingguan Terbuka', [
        `Hadiah Mingguan : +${formatNumber(res.reward)} ${cur}${res.isPremium ? ' (Bonus VIP +25% ✦)' : ''}`,
        `Bonus XP        : +${res.xpGain} XP${res.xpResult?.leveledUp ? ` (Naik ke Lv.${res.xpResult.newLevel}!)` : ''}`,
        `Saldo Sekarang  : ${formatNumber(res.newBalance)} ${cur}`,
      ])
    );
  },
};
