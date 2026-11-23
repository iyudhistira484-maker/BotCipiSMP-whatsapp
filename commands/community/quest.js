const config = require('../../config');
const {
  ensureUserDailyQuests,
  claimDailyQuestRewards,
} = require('../../lib/scheduler');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');
const { getWibDateKey, formatNumber } = require('../../lib/logger');

function buildMiniProgressBar(current, target, len = 6) {
  const ratio = target > 0 ? Math.min(1, current / target) : 0;
  const filled = Math.round(ratio * len);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, len - filled))}]`;
}

module.exports = {
  name: 'quest',
  alias: ['misi', 'dailyquest', 'quests'],
  category: 'community',
  description: 'Lihat 3 Misi Harian acakmu & klaim hadiah koin + XP (reset 00:00 WIB)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, args } = ctx;
    const p = config.prefix;
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'klaim' || sub === 'claim') {
      const claimRes = claimDailyQuestRewards(senderJid);
      if (!claimRes.ok) {
        const allDone =
          Array.isArray(claimRes.rows) &&
          claimRes.rows.length === 3 &&
          claimRes.rows.every((r) => Number(r.claimed) === 1);

        await ctx.reply(
          formatError(
            allDone ? 'Semua Misi Hari Ini Tuntas!' : 'Belum Ada Hadiah Siap Klaim',
            allDone
              ? [
                  'Kamu sudah menyelesaikan dan mengklaim ketiga misi harian hari ini 🎉',
                  'Misi baru akan diacak kembali pukul 00:00 WIB ya ♡',
                ]
              : [
                  `Selesaikan progres misimu terlebih dahulu lalu ketik ${mono(`${p}quest klaim`)} ♡`,
                ]
          )
        );
        return;
      }

      const lines = [
        `✦ Misi Diklaim : ${claimRes.claimedTitles.map((t) => keep(t)).join(', ')}`,
        `✦ Total Koin   : +${formatNumber(claimRes.totalCoins)} ${config.economy.currencyName}`,
        `✦ Total XP     : +${formatNumber(claimRes.totalXp)} XP`,
        claimRes.fullClearBonusCoins > 0
          ? `🎉 Bonus Komplit 3/3: Termasuk ekstra +${claimRes.fullClearBonusCoins} Koin & +${claimRes.fullClearBonusXp} XP!`
          : '',
        claimRes.xpResult?.leveledUp
          ? `✨ NAIK LEVEL! Sekarang kamu Lv.${claimRes.xpResult.newLevel}!`
          : '',
        `◦ Saldo Sekarang: ${formatNumber(claimRes.newBalance)} ${config.economy.currencyName}`,
      ].filter(Boolean);

      await ctx.reply(formatSuccess('Hadiah Quest Berhasil Diklaim!', lines));
      return;
    }

    // Tampilkan daftar 3 misi acak hari ini
    const quests = ensureUserDailyQuests(senderJid);
    const todayWib = getWibDateKey();
    let hasClaimable = false;

    const lines = [`✦ Tanggal WIB : ${keep(todayWib)} (Reset pukul 00:00 WIB)`, ''];

    quests.forEach((q, idx) => {
      const cur = Number(q.current_count || 0);
      const tgt = Number(q.target_count || 1);
      const isClaimed = Number(q.claimed) === 1;
      const isReady = cur >= tgt && !isClaimed;
      if (isReady) hasClaimable = true;

      const statusBadge = isClaimed
        ? '✅ Diklaim'
        : isReady
        ? '🎁 Siap Klaim!'
        : `${cur}/${tgt}`;

      lines.push(`❖ Misi #${idx + 1}: *${keep(q.quest_title)}*`);
      lines.push(
        `  ${keep(buildMiniProgressBar(cur, tgt))} ${statusBadge} • Hadiah: +${formatNumber(
          q.reward_balance
        )} ✿ & +${q.reward_xp} XP`
      );
    });

    lines.push('');
    lines.push('◦ Bonus Sapu Bersih 3/3: +300 Sakura Coin & +80 XP ekstra!');
    if (hasClaimable) {
      lines.push(`◦ Ketik ${mono(`${p}quest klaim`)} atau tekan tombol di bawah untuk klaim ♡`);
    }

    const box = renderBox('✿ 3 ᴍɪsɪ ʜᴀʀɪᴀɴ ᴋᴀᴍᴜ', lines, {
      footer: config.footer,
    });

    const buttons = [];
    if (hasClaimable) {
      buttons.push({
        command: `${p}quest klaim`,
        text: '🎁 Klaim Hadiah Quest',
      });
    }
    buttons.push({
      command: `${p}topserver quest`,
      text: '✿ Top Rajin Quest',
    });

    await ctx.replyCard(null, box, {
      title: '✿ Quest Harian CipiSMP ✿',
      buttons,
    });
  },
};
