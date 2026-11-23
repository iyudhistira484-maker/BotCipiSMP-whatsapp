const config = require('../../config');
const { getUserProfile } = require('../../lib/database');
const { getServerLeaderboardData } = require('../../lib/scheduler');
const { renderLeaderboardCard } = require('../../lib/card');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

function formatHoursMinutes(totalMinutes = 0) {
  const m = Math.max(0, Number(totalMinutes || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}j ${rem}m` : `${rem}m`;
}

module.exports = {
  name: 'topserver',
  alias: ['rankserver', 'topmc', 'playtime', 'topquest'],
  category: 'community',
  description: 'Kartu Papan Peringkat Server CipiSMP (Jam Bermain Minecraft & Penyelesai Quest)',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, commandName, args } = ctx;
    const p = config.prefix;

    const wantQuest =
      commandName === 'topquest' ||
      ['quest', 'misi', 'quests'].includes((args[0] || '').toLowerCase());
    const mode = wantQuest ? 'quest' : 'playtime';

    const me = getUserProfile(senderJid, pushName);
    const lb = getServerLeaderboardData(mode, senderJid, 10);

    const cardEntries = lb.rows.map((r) => {
      if (mode === 'quest') {
        return {
          name: r.name,
          subText: `Lv.${r.level} ${r.isBedrock ? '• Bedrock [BE]' : '• Petualang'}`,
          valueText: `${formatNumber(r.completedQuests)} Misi`,
        };
      }
      return {
        name: r.name,
        subText: `Lv.${r.level} ${r.isLinked ? (r.isBedrock ? '• Bedrock [BE]' : '• Java') : '• Member WA'}`,
        valueText: formatHoursMinutes(r.playtimeMinutes),
      };
    });

    const callerSummary =
      mode === 'quest'
        ? `#${lb.callerRank || '-'} • ${keep(me.name)}`
        : `#${lb.callerRank || '-'} • ${keep(me.mcLink?.mc_username || me.name)} (${formatHoursMinutes(me.playtimeMinutes)})`;

    const textLines = lb.rows.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const beBadge = r.isBedrock ? ' [BE]' : '';
      if (mode === 'quest') {
        return `${medal} ${keep(r.name)}${keep(beBadge)} — ${formatNumber(r.completedQuests)} Misi Selesai`;
      }
      return `${medal} ${keep(r.name)}${keep(beBadge)} — ${keep(formatHoursMinutes(r.playtimeMinutes))}`;
    });

    if (textLines.length === 0) {
      textLines.push(
        mode === 'quest'
          ? `Belum ada misi harian yang diklaim — yuk cek ${p}quest ♡`
          : `Belum ada data jam bermain tercatat — yuk tautkan akunmu lewat ${p}link ♡`
      );
    }

    textLines.push('');
    textLines.push(`✦ Posisi Kamu: ${callerSummary}`);

    const caption = renderBox(
      mode === 'quest'
        ? '✿ ᴛᴏᴘ 10 ᴘᴇᴛᴜᴀʟᴀɴɢ ᴍɪsɪ ʜᴀʀɪᴀɴ'
        : '❖ ᴛᴏᴘ 10 ᴘᴇᴍᴀɪɴ ᴛᴇʀᴀᴋᴛɪꜰ sᴇʀᴠᴇʀ',
      textLines,
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderLeaderboardCard({
        mode,
        title:
          mode === 'quest'
            ? 'Top 10 Penyelesai Quest'
            : 'Top 10 Jam Main CipiSMP',
        subtitle:
          mode === 'quest'
            ? 'Warga paling rajin menuntaskan Misi Harian komunitas ♡'
            : 'Pemain Java & Bedrock paling setia menjelajah dunia CipiSMP ♡',
        entries: cardEntries,
        callerRank: lb.callerRank,
        callerSummary,
      });
    } catch (err) {
      logger.error('CMD:TOPSERVER', 'Gagal merender kartu topserver, memakai fallback teks', err);
    }

    await ctx.replyCard(cardBuffer, caption, {
      title: `❖ Peringkat Server CipiSMP ❖`,
      buttons: [
        { command: `${p}topserver playtime`, text: '❖ Top Jam Main' },
        { command: `${p}topserver quest`, text: '✿ Top Quest' },
        { command: `${p}leaderboard saldo`, text: '♡ Top Saldo' },
      ],
    });
  },
};
