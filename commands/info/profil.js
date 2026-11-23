const config = require('../../config');
const { getUserProfile, normalizeUserJid } = require('../../lib/database');
const { formatRemainingLimit } = require('../../lib/limits');
const { renderProfileCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'profil',
  alias: ['profile', 'me', 'my', 'kartu'],
  category: 'info',
  description: 'Lihat kartu profil kawaii, level, bar XP, saldo, dan akun Minecraft',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, mentionedJids } = ctx;

    // Bisa melihat profil sendiri atau @mention teman di grup
    const targetJid =
      mentionedJids && mentionedJids.length > 0
        ? normalizeUserJid(mentionedJids[0])
        : senderJid;
    const isSelf = targetJid === senderJid;

    const profile = getUserProfile(targetJid, isSelf ? pushName : '');
    const aiLimitText = formatRemainingLimit(targetJid, 'ai');
    const dlLimitText = formatRemainingLimit(targetJid, 'downloader');

    // Ambil URL foto profil WhatsApp dengan timeout aman (fallback ke avatar anime lokal)
    let avatarUrl = null;
    try {
      avatarUrl = await Promise.race([
        sock.profilePictureUrl(targetJid, 'image'),
        new Promise((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);
    } catch {
      avatarUrl = null;
    }

    const mcInfo = profile.mcLink
      ? `${keep(profile.mcLink.mc_username)} ${profile.mcLink.is_bedrock ? '(Bedrock)' : '(Java)'}`
      : 'Belum ditautkan';

    const vipInfo = profile.premium.isOwner
      ? 'Owner CipiSMP ✦'
      : profile.premium.isPremium
      ? `Sakura VIP (aktif s/d ${new Date(profile.premium.expiresAt).toLocaleDateString('id-ID', {
          timeZone: config.timezone,
        })})`
      : 'Member Reguler';

    const caption = renderBox(
      'ᴋᴀʀᴛᴜ ᴘʀᴏꜰɪʟ ᴘᴇᴛᴜᴀʟᴀɴɢ',
      [
        `✦ Nama      : ${keep(profile.name)}`,
        `✦ Status    : ${vipInfo}`,
        `✦ Level     : Lv.${profile.level} (${formatNumber(profile.xp)}/${formatNumber(profile.xpNeeded)} XP)`,
        `✦ Saldo     : ${formatNumber(profile.balance)} ${config.economy.currencyName}`,
        `✦ Minecraft : ${mcInfo}`,
        `✦ Gacha     : ${profile.gacha.uniqueCount} waifu (${profile.gacha.ssrCount} SSR)`,
        `◦ Limit AI  : ${aiLimitText}`,
        `◦ Limit DL  : ${dlLimitText}`,
      ],
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderProfileCard({
        profile,
        avatarUrl,
        aiLimitText,
        dlLimitText,
      });
    } catch (err) {
      logger.error('CMD:PROFIL', 'Gagal merender kartu profil, memakai fallback teks', err);
    }

    await sendButtons(sock, chatJid, {
      title: `❖ Profil ${keep(profile.name)} ❖`,
      text: caption,
      footer: config.footer,
      image: cardBuffer,
      ownerJid: senderJid,
      mentions: [targetJid],
      quoted: msg,
      buttons: [
        { command: `${config.prefix}menu`, text: '✿ Menu Utama' },
        { command: `${config.prefix}ping`, text: '✦ Cek Ping' },
      ],
    });
  },
};
