const config = require('../../config');
const { getUserProfile, normalizeUserJid } = require('../../lib/database');
const { getEconomy } = require('../../lib/economy');
const { renderStatusCard } = require('../../lib/card');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'saldo',
  alias: ['bal', 'balance', 'uang', 'dompet', 'koin'],
  category: 'economy',
  description: 'Cek jumlah saldo Sakura Coin, tabungan bank, dan shards gacha',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, mentionedJids } = ctx;
    const targetJid =
      mentionedJids && mentionedJids.length > 0
        ? normalizeUserJid(mentionedJids[0])
        : senderJid;
    const isSelf = targetJid === senderJid;

    const prof = getUserProfile(targetJid, isSelf ? pushName : '');
    const eco = getEconomy(targetJid);
    const totalWealth = eco.balance + eco.bank;
    const cur = config.economy.currencyName;

    const caption = renderBox(
      '✿ ᴅᴏᴍᴘᴇᴛ sᴀᴋᴜʀᴀ ᴄᴏɪɴ',
      [
        `✦ Pemilik     : ${keep(prof.name)}`,
        `✦ Dompet      : ${formatNumber(eco.balance)} ${cur}`,
        `✦ Tabungan    : ${formatNumber(eco.bank)} ${cur}`,
        `✦ Total Harta : ${formatNumber(totalWealth)} ${cur}`,
        `◦ Shards Gacha: ${formatNumber(eco.gachaShards)} pecahan`,
        `◦ Streak Daily: ${eco.dailyStreak} hari beruntun`,
      ],
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderStatusCard({
        title: `Dompet ${keep(prof.name)}`,
        subtitle: `Kelola Sakura Coin dan rajin klaim hadiah harianmu ya ♡`,
        badgeText: prof.premium.isPremium ? '✦ SAKURA VIP' : '✿ EKONOMI',
        badgeRarity: prof.premium.isPremium ? 'SSR' : 'R',
        rows: [
          ['Saldo Dompet', `${formatNumber(eco.balance)} ${cur}`],
          ['Tabungan Bank', `${formatNumber(eco.bank)} ${cur}`],
          ['Total Kekayaan', `${formatNumber(totalWealth)} ${cur}`],
          ['Shards Gacha', `${formatNumber(eco.gachaShards)} pecahan`],
          ['Daily Streak', `${eco.dailyStreak} hari`],
        ],
        cacheKey: `saldo:${targetJid}:${eco.balance}:${eco.bank}`,
      });
    } catch (err) {
      logger.error('CMD:SALDO', 'Gagal membuat kartu saldo, memakai fallback teks', err);
    }

    await ctx.replyCard(cardBuffer, caption, {
      mentions: [targetJid],
      buttons: [
        { command: `${config.prefix}daily`, text: '✿ Klaim Daily' },
        { command: `${config.prefix}kerja`, text: '✦ Kerja' },
        { command: `${config.prefix}leaderboard saldo`, text: '❖ Top Saldo' },
      ],
    });
  },
};
