const config = require('../../config');
const {
  ensureUser,
  getPremiumStatus,
  normalizeUserJid,
} = require('../../lib/database');
const { formatTimestampWib } = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'vip',
  alias: ['premium', 'cekprem', 'cekvip'],
  category: 'info',
  description: 'Cek masa aktif Sakura VIP kamu beserta daftar keuntungan eksklusifnya',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, mentionedJids, prefix } = ctx;

    const targetJid =
      mentionedJids && mentionedJids.length > 0
        ? normalizeUserJid(mentionedJids[0])
        : senderJid;
    const isSelf = targetJid === senderJid;
    const user = ensureUser(targetJid, isSelf ? pushName : '');
    const prem = getPremiumStatus(targetJid);

    const statusLines = [];
    if (prem.isOwner) {
      statusLines.push(
        `✦ Nama   : ${keep(user?.name || 'Owner')}`,
        `✦ Status : 👑 Owner CipiSMP (VIP Permanen Tanpa Batas)`
      );
    } else if (prem.isPremium) {
      const daysLeft = Math.max(
        1,
        Math.ceil((Number(prem.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000))
      );
      statusLines.push(
        `✦ Nama        : ${keep(user?.name || 'Sahabat Cipi')}`,
        `✦ Status      : 🌸 Sakura VIP Aktif (${daysLeft} Hari Tersisa)`,
        `✦ Berlaku s/d : ${keep(formatTimestampWib(prem.expiresAt))}`
      );
    } else {
      statusLines.push(
        `✦ Nama   : ${keep(user?.name || 'Sahabat Cipi')}`,
        `✦ Status : Member Reguler`
      );
    }

    const lines = [
      ...statusLines,
      '',
      '❖ Keuntungan Eksklusif Sakura VIP:',
      `  ◦ Limit AI Harian naik drastis (${config.limits.free.ai} -> ${config.limits.premium.ai}/hari)`,
      `  ◦ Limit Downloader Harian (${config.limits.free.downloader} -> ${config.limits.premium.downloader}/hari)`,
      `  ◦ Cooldown command 50% lebih cepat!`,
      `  ◦ Bonus +25% Sakura Coin & XP obrolan otomatis!`,
      `  ◦ Lencana eksklusif Sakura VIP di Kartu Profil!`,
    ];

    await sendButtons(sock, chatJid, {
      title: '❖ Info Sakura VIP CipiSMP ❖',
      text: renderBox('🌸 sᴛᴀᴛᴜs sᴀᴋᴜʀᴀ ᴠɪᴘ', lines, { footer: config.footer }),
      footer: config.footer,
      ownerJid: senderJid,
      mentions: [targetJid],
      quoted: msg,
      buttons: [
        { id: `${prefix}profil`, text: '🪪 Kartu Profil' },
        { id: `${prefix}owner`, text: '💌 Hubungi Owner' },
      ],
    });
  },
};
