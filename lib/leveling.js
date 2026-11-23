const config = require('../config');
const {
  getDb,
  addXp,
  getPremiumStatus,
  extractPhoneFromJid,
} = require('./database');
const { addBalance } = require('./economy');
const { renderBox, keep } = require('./smallcaps');
const { formatNumber, logger } = require('./logger');

const lastXpAwardMap = new Map();

const LEVEL_TITLES = Object.freeze([
  { minLevel: 50, title: 'Penguasa Sakura ✿' },
  { minLevel: 35, title: 'Legenda Kawaii ✦' },
  { minLevel: 20, title: 'Bintang CipiSMP ❖' },
  { minLevel: 10, title: 'Ksatria Pink ♡' },
  { minLevel: 5, title: 'Penjelajah Sakura' },
  { minLevel: 1, title: 'Pendatang Baru' },
]);

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [jid, ts] of lastXpAwardMap.entries()) {
    if (ts < cutoff) lastXpAwardMap.delete(jid);
  }
}, 5 * 60 * 1000).unref();

/**
 * Tentukan gelar otomatis sesuai level user
 * @param {number} level
 * @returns {string}
 */
function getMilestoneTitle(level) {
  const lvl = Number(level || 1);
  for (const item of LEVEL_TITLES) {
    if (lvl >= item.minLevel) return item.title;
  }
  return 'Pendatang Baru';
}

/**
 * Proses pemberian XP otomatis saat user aktif mengobrol
 */
async function handleChatXp({ sock, msg, chatJid, senderJid, senderNumber, pushName, isGroup, body, userRow }) {
  if (!body || !senderJid || userRow?.is_banned) return;

  const trimmed = body.trim();
  // Abaikan pesan yang terlalu pendek atau berupa trigger command
  if (trimmed.length < 3 || trimmed.startsWith(config.prefix || '.')) {
    return;
  }

  // Jika grup sedang di-mute, jangan kirim pengumuman level-up di grup tersebut
  if (isGroup) {
    const grp = getDb().get('SELECT mute FROM groups WHERE jid = ?', [chatJid]);
    if (grp?.mute) return;
  }

  const now = Date.now();
  const cooldownMs = Number(config.economy.xpCooldownMs || 25000);
  const lastTs = lastXpAwardMap.get(senderJid) || 0;
  if (now - lastTs < cooldownMs) {
    return;
  }
  lastXpAwardMap.set(senderJid, now);

  const minXp = Number(config.economy.xpPerMessageMin || 6);
  const maxXp = Number(config.economy.xpPerMessageMax || 14);
  const baseXp = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;
  const prem = getPremiumStatus(senderJid);
  const finalXp = prem.isPremium
    ? Math.round(baseXp * (config.economy.premiumBonusMultiplier || 1.25))
    : baseXp;

  const xpResult = addXp(senderJid, finalXp);
  if (!xpResult.leveledUp) return;

  // Hadiah naik level otomatis: koin + gelar baru
  const bonusCoins = xpResult.newLevel * 100;
  addBalance(senderJid, bonusCoins);

  const nextTitle = getMilestoneTitle(xpResult.newLevel);
  const defaultTitles = new Set(LEVEL_TITLES.map((t) => t.title));
  if (!userRow?.title || defaultTitles.has(userRow.title)) {
    getDb().run('UPDATE users SET title = ?, updated_at = ? WHERE jid = ?', [
      nextTitle,
      now,
      senderJid,
    ]);
  }

  if (!config.economy.levelUpNotify) return;

  const num = senderNumber || extractPhoneFromJid(senderJid);
  const tag = num ? `@${num}` : keep(pushName || 'Sahabat Cipi');

  const text = renderBox(
    '✿ ʟᴇᴠᴇʟ ᴜᴘ! ✿',
    [
      `✦ Selamat ${tag}, level kamu naik! ♡`,
      `◦ Level Baru : Lv.${xpResult.oldLevel} -> Lv.${xpResult.newLevel}`,
      `◦ Gelar      : ${nextTitle}`,
      `◦ Hadiah     : +${formatNumber(bonusCoins)} ${config.economy.currencyName}`,
    ],
    { footer: 'ᴛᴇʀᴜs aktif ᴍᴇɴɢᴏʙʀᴏʟ ᴅɪ ᴄɪᴘɪsᴍᴘ ʏᴀ ♡' }
  );

  try {
    await sock.sendMessage(
      chatJid,
      {
        text,
        mentions: [senderJid],
      },
      { quoted: msg }
    );
  } catch (err) {
    logger.warn('LEVEL', `Gagal mengirim notifikasi naik level: ${err.message}`);
  }
}

function register({ registerHook }) {
  registerHook('onMessagePreCommand', handleChatXp);
  logger.info('LEVEL', 'Sistem XP & Level-Up otomatis aktif');
}

module.exports = {
  LEVEL_TITLES,
  getMilestoneTitle,
  handleChatXp,
  register,
};
