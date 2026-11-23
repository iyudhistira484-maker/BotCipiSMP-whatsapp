const config = require('../../config');
const { getUserProfile, normalizeUserJid } = require('../../lib/database');
const { getLeaderboardData } = require('../../lib/economy');
const { getMilestoneTitle } = require('../../lib/leveling');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'level',
  alias: ['xp', 'rankku'],
  category: 'economy',
  description: 'Cek progres XP, peringkat level server, dan gelar petualangmu',
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

    const prof = getUserProfile(targetJid, targetJid === senderJid ? pushName : '');
    const lbInfo = getLeaderboardData('level', targetJid, 1);
    const pct = Math.round(prof.xpProgress * 100);
    const filledBlocks = Math.round(prof.xpProgress * 10);
    const barAscii = `${'█'.repeat(filledBlocks)}${'░'.repeat(Math.max(0, 10 - filledBlocks))}`;
    const remainingXp = Math.max(0, prof.xpNeeded - prof.xp);

    const box = renderBox(
      '✦ sᴛᴀᴛᴜs ʟᴇᴠᴇʟ & xᴘ',
      [
        `✦ Nama       : ${keep(prof.name)}`,
        `✦ Gelar      : ${getMilestoneTitle(prof.level)}`,
        `✦ Peringkat  : #${lbInfo.callerRank || '-'} di server`,
        `✦ Level      : Lv.${prof.level}`,
        `✦ Progres XP : [${keep(barAscii)}] ${pct}%`,
        `◦ Detail XP  : ${formatNumber(prof.xp)} / ${formatNumber(prof.xpNeeded)} XP (kurang ${formatNumber(remainingXp)} XP)`,
      ],
      { footer: config.footer }
    );

    await ctx.reply(box, { mentions: [targetJid] });
  },
};
