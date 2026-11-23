const config = require('../config');
const { getDb, normalizeUserJid, getPremiumStatus, isOwner } = require('./database');
const { getWibDateKey } = require('./logger');
const { smallcaps } = require('./smallcaps');

// Penyimpanan memori ringan untuk cooldown & rate limit real-time
const cooldownStore = new Map();
const rateLimitStore = new Map();

/**
 * Bersihkan entri memori kedaluwarsa secara berkala agar hemat RAM 24/7
 */
function sweepMemoryStores() {
  const now = Date.now();
  for (const [key, exp] of cooldownStore.entries()) {
    if (exp <= now) cooldownStore.delete(key);
  }
  const windowMs = config.cooldown.rateLimitWindowMs || 10000;
  for (const [jid, timestamps] of rateLimitStore.entries()) {
    const valid = timestamps.filter((t) => now - t < windowMs);
    if (valid.length === 0) rateLimitStore.delete(jid);
    else rateLimitStore.set(jid, valid);
  }
}

setInterval(sweepMemoryStores, 60 * 1000).unref();

/**
 * Cek rate limit global per user (mencegah banjir command beruntun)
 * @param {string} rawJid
 * @returns {{ allowed: boolean, retryAfterSec: number }}
 */
function checkRateLimit(rawJid) {
  const jid = normalizeUserJid(rawJid);
  if (isOwner(jid)) {
    return { allowed: true, retryAfterSec: 0 };
  }

  const now = Date.now();
  const windowMs = config.cooldown.rateLimitWindowMs || 10000;
  const maxCmd = config.cooldown.rateLimitMaxCommands || 7;

  const history = (rateLimitStore.get(jid) || []).filter((ts) => now - ts < windowMs);
  if (history.length >= maxCmd) {
    const oldest = history[0];
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSec };
  }

  history.push(now);
  rateLimitStore.set(jid, history);
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Cek & aktifkan cooldown per command untuk seorang user
 * User Premium mendapat pengurangan durasi cooldown sesuai config
 *
 * @param {string} rawJid
 * @param {string} commandName
 * @param {number} [baseCooldownSec]
 * @returns {{ allowed: boolean, remainingSec: number, effectiveCooldownSec: number }}
 */
function checkCooldown(rawJid, commandName, baseCooldownSec) {
  const jid = normalizeUserJid(rawJid);
  if (isOwner(jid)) {
    return { allowed: true, remainingSec: 0, effectiveCooldownSec: 0 };
  }

  const rawSec =
    baseCooldownSec !== undefined && baseCooldownSec !== null
      ? Number(baseCooldownSec)
      : Number(config.cooldown.defaultSec || 4);

  if (rawSec <= 0) {
    return { allowed: true, remainingSec: 0, effectiveCooldownSec: 0 };
  }

  const prem = getPremiumStatus(jid);
  const multiplier = prem.isPremium ? Number(config.cooldown.premiumMultiplier || 0.5) : 1;
  const effectiveMs = Math.max(1000, Math.round(rawSec * 1000 * multiplier));

  const key = `${jid}:${commandName}`;
  const now = Date.now();
  const expiresAt = cooldownStore.get(key) || 0;

  if (expiresAt > now) {
    const remainingSec = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    return {
      allowed: false,
      remainingSec,
      effectiveCooldownSec: Math.round(effectiveMs / 1000),
    };
  }

  cooldownStore.set(key, now + effectiveMs);
  return {
    allowed: true,
    remainingSec: 0,
    effectiveCooldownSec: Math.round(effectiveMs / 1000),
  };
}

/**
 * Ambil kuota maksimum harian berdasarkan status Free / Premium / Owner
 * @param {string} rawJid
 * @param {'ai'|'downloader'|string} feature
 */
function getMaxDailyLimit(rawJid, feature) {
  const jid = normalizeUserJid(rawJid);
  if (isOwner(jid)) {
    return Infinity;
  }
  const prem = getPremiumStatus(jid);
  const bucket = prem.isPremium ? config.limits.premium : config.limits.free;
  const configured = bucket?.[feature];
  return Number.isFinite(Number(configured)) ? Number(configured) : prem.isPremium ? 100 : 15;
}

/**
 * Cek status pemakaian limit harian tanpa mengurangi kuota (berbasis tanggal WIB)
 * @param {string} rawJid
 * @param {'ai'|'downloader'|string} feature
 */
function getDailyLimitStatus(rawJid, feature) {
  const jid = normalizeUserJid(rawJid);
  const dateKey = getWibDateKey();
  const max = getMaxDailyLimit(jid, feature);

  if (!Number.isFinite(max)) {
    return {
      dateKey,
      feature,
      used: 0,
      max: null,
      remaining: Infinity,
      isUnlimited: true,
      allowed: true,
    };
  }

  const row = getDb().get(
    'SELECT used_count FROM daily_limits WHERE jid = ? AND limit_date = ? AND feature = ?',
    [jid, dateKey, feature]
  );
  const used = Number(row?.used_count || 0);
  const remaining = Math.max(0, max - used);

  return {
    dateKey,
    feature,
    used,
    max,
    remaining,
    isUnlimited: false,
    allowed: remaining > 0,
  };
}

/**
 * Gunakan kuota limit harian (otomatis reset saat pergantian tanggal 00:00 WIB)
 * @param {string} rawJid
 * @param {'ai'|'downloader'|string} feature
 * @param {number} [amount=1]
 */
function consumeDailyLimit(rawJid, feature, amount = 1) {
  const jid = normalizeUserJid(rawJid);
  const status = getDailyLimitStatus(jid, feature);
  if (status.isUnlimited) {
    return status;
  }

  if (status.remaining < amount) {
    return {
      ...status,
      allowed: false,
    };
  }

  const now = Date.now();
  const nextUsed = status.used + amount;
  getDb().run(
    `INSERT INTO daily_limits (jid, limit_date, feature, used_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(jid, limit_date, feature)
     DO UPDATE SET used_count = excluded.used_count, updated_at = excluded.updated_at`,
    [jid, status.dateKey, feature, nextUsed, now]
  );

  return {
    dateKey: status.dateKey,
    feature,
    used: nextUsed,
    max: status.max,
    remaining: Math.max(0, status.max - nextUsed),
    isUnlimited: false,
    allowed: true,
  };
}

/**
 * Format tampilan sisa limit untuk disertakan di balasan bot
 * @param {string} rawJid
 * @param {'ai'|'downloader'|string} feature
 */
function formatRemainingLimit(rawJid, feature) {
  const st = getDailyLimitStatus(rawJid, feature);
  if (st.isUnlimited) {
    return smallcaps('♾️ unlimited (owner)');
  }
  return `${st.remaining}/${st.max} ${smallcaps('(reset 00:00 wib)')}`;
}

/**
 * Bersihkan histori daily_limits yang lebih lama dari 7 hari agar database tetap ramping
 */
function pruneOldDailyLimits() {
  const cutoffDate = new Date(Date.now() - 7 * 86400 * 1000);
  const cutoffKey = getWibDateKey(cutoffDate);
  const res = getDb().run('DELETE FROM daily_limits WHERE limit_date < ?', [cutoffKey]);
  return res.changes;
}

module.exports = {
  checkRateLimit,
  checkCooldown,
  getMaxDailyLimit,
  getDailyLimitStatus,
  consumeDailyLimit,
  formatRemainingLimit,
  pruneOldDailyLimits,
};
