const config = require('../../config');
const { getUserProfile } = require('../../lib/database');
const { getLeaderboardData } = require('../../lib/economy');
const { renderLeaderboardCard } = require('../../lib/card');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'leaderboard',
  alias: ['lb', 'top', 'rank', 'peringkat'],
  category: 'economy',
  description: 'Lihat kartu papan peringkat Top 10 Saldo atau Level tertinggi',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, args } = ctx;
    const rawMode = (args[0] || 'saldo').toLowerCase();
    const mode = ['level', 'xp', 'lvl'].includes(rawMode) ? 'level' : 'saldo';

    const me = getUserProfile(senderJid, pushName);
    const lb = getLeaderboardData(mode, senderJid, 10);
    const cur = config.economy.currencyName;

    const cardEntries = lb.rows.map((r) => {
      if (mode === 'level') {
        return {
          name: r.name,
          subText: `${r.title} • ${formatNumber(r.xp)} XP`,
          valueText: `Lv. ${r.level}`,
        };
      }
      return {
        name: r.name,
        subText: `Lv.${r.level} Petualang`,
        valueText: `${formatNumber(r.netWorth)} ✿`,
      };
    });

    const callerSummary =
      mode === 'level'
        ? `#${lb.callerRank || '-'} • ${keep(me.name)} (Lv.${me.level} — ${formatNumber(me.xp)} XP)`
        : `#${lb.callerRank || '-'} • ${keep(me.name)} (${formatNumber(me.balance + me.bank)} ${cur})`;

    const textLines = lb.rows.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      if (mode === 'level') {
        return `${medal} ${keep(r.name)} — Lv.${r.level} (${formatNumber(r.xp)} XP)`;
      }
      return `${medal} ${keep(r.name)} — ${formatNumber(r.netWorth)} ${cur}`;
    });

    if (textLines.length === 0) {
      textLines.push('Belum ada data petualang yang tercatat ♡');
    }
    textLines.push('');
    textLines.push(`✦ Posisi Kamu: ${callerSummary}`);

    const caption = renderBox(
      mode === 'level' ? '❖ ᴛᴏᴘ 10 ʟᴇᴠᴇʟ ᴘᴇᴛᴜᴀʟᴀɴɢ' : '✿ ᴛᴏᴘ 10 sᴜʟᴛᴀɴ sᴀᴋᴜʀᴀ ᴄᴏɪɴ',
      textLines,
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderLeaderboardCard({
        mode,
        title: mode === 'level' ? 'Top 10 Level Tertinggi' : 'Top 10 Sultan Sakura Coin',
        subtitle:
          mode === 'level'
            ? 'Petualang paling aktif mengobrol & berpetualang di CipiSMP ♡'
            : 'Petualang dengan total kekayaan Sakura Coin terbanyak ♡',
        entries: cardEntries,
        callerRank: lb.callerRank,
        callerSummary,
      });
    } catch (err) {
      logger.error('CMD:LB', 'Gagal merender kartu leaderboard, memakai fallback teks', err);
    }

    await ctx.replyCard(cardBuffer, caption, {
      buttons: [
        {
          command: `${config.prefix}leaderboard saldo`,
          text: '✿ Top Saldo',
        },
        {
          command: `${config.prefix}leaderboard level`,
          text: '✦ Top Level',
        },
        {
          command: `${config.prefix}profil`,
          text: '♡ Profilku',
        },
      ],
    });
  },
};
