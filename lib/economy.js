const config = require('../config');
const {
  getDb,
  ensureUser,
  normalizeUserJid,
  getPremiumStatus,
  addXp,
  addAuditLog,
} = require('./database');

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const KAWAII_JOBS = Object.freeze([
  {
    role: 'Penjaga Toko Roti Sakura',
    story: 'Kamu memanggang roti stroberi hangat untuk para petualang CipiSMP',
  },
  {
    role: 'Penambang Kristal Pink',
    story: 'Kamu turun ke gua Y=-58 dan menemukan kilau bijih langka yang cantik',
  },
  {
    role: 'Barista Kafe Neko',
    story: 'Kamu menyajikan matcha latte berbentuk kucing imut kepada pelanggan setia',
  },
  {
    role: 'Kurir Paket Spawn',
    story: 'Kamu mengantar peti logistik tepat waktu ke markas guild CipiSMP',
  },
  {
    role: 'Petani Kebun Ceri',
    story: 'Kamu memanen buah ceri segar dan merangkai bunga sakura pilihan',
  },
  {
    role: 'Penjaga Perpustakaan Sihir',
    story: 'Kamu merapikan buku Enchanted Mending dan Unbreaking III dengan teliti',
  },
  {
    role: 'Koki Bento Piknik',
    story: 'Kamu menyiapkan bekal onigiri bintang untuk ekspedisi Nether',
  },
]);

/**
 * Format sisa waktu milidetik menjadi teks jam-menit-detik yang mudah dibaca
 * @param {number} ms
 * @returns {string}
 */
function formatCountdown(ms) {
  const totalSec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  if (minutes > 0) parts.push(`${minutes} menit`);
  if (seconds > 0 && days === 0) parts.push(`${seconds} detik`);
  return parts.join(' ');
}

/**
 * Ambil data dompet user (otomatis membuat baris awal bila belum ada)
 * @param {string} rawJid
 * @param {string} [pushName]
 */
function getEconomy(rawJid, pushName = '') {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid, pushName);
  const row = getDb().get('SELECT * FROM economy WHERE jid = ?', [jid]);
  return {
    jid,
    balance: Number(row?.balance ?? config.economy.startingBalance),
    bank: Number(row?.bank ?? 0),
    gems: Number(row?.gems ?? 0),
    gachaShards: Number(row?.gacha_shards ?? 0),
    pityCounter: Number(row?.pity_counter ?? 0),
    dailyStreak: Number(row?.daily_streak ?? 0),
    lastDaily: Number(row?.last_daily ?? 0),
    lastWeekly: Number(row?.last_weekly ?? 0),
    lastWork: Number(row?.last_work ?? 0),
    totalEarned: Number(row?.total_earned ?? 0),
    totalSpent: Number(row?.total_spent ?? 0),
  };
}

/**
 * Tambah saldo Sakura Coin user secara atomik
 * @param {string} rawJid
 * @param {number} amount
 */
function addBalance(rawJid, amount) {
  const jid = normalizeUserJid(rawJid);
  const cleanAmount = Math.max(0, Math.floor(Number(amount || 0)));
  ensureUser(jid);
  const now = Date.now();

  const db = getDb();
  return db.transaction(() => {
    db.run(
      `UPDATE economy
       SET balance = balance + ?, total_earned = total_earned + ?, updated_at = ?
       WHERE jid = ?`,
      [cleanAmount, cleanAmount, now, jid]
    );
    const updated = db.get('SELECT balance FROM economy WHERE jid = ?', [jid]);
    return Number(updated?.balance || 0);
  });
}

/**
 * Kurangi saldo user secara aman (gagal bila saldo tidak cukup)
 * @param {string} rawJid
 * @param {number} amount
 */
function deductBalance(rawJid, amount) {
  const jid = normalizeUserJid(rawJid);
  const cleanAmount = Math.max(0, Math.floor(Number(amount || 0)));
  ensureUser(jid);
  const now = Date.now();

  const db = getDb();
  return db.transaction(() => {
    const cur = db.get('SELECT balance FROM economy WHERE jid = ?', [jid]);
    const curBal = Number(cur?.balance || 0);
    if (curBal < cleanAmount) {
      return { ok: false, balance: curBal, newBalance: curBal };
    }
    db.run(
      `UPDATE economy
       SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ?
       WHERE jid = ?`,
      [cleanAmount, cleanAmount, now, jid]
    );
    const nextBal = curBal - cleanAmount;
    return { ok: true, balance: nextBal, newBalance: nextBal };
  });
}

/**
 * Klaim hadiah harian (.daily) dengan perhitungan streak beruntun & bonus VIP
 * @param {string} rawJid
 * @param {string} [pushName]
 */
function claimDaily(rawJid, pushName = '') {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid, pushName);
  const db = getDb();
  const now = Date.now();
  const prem = getPremiumStatus(jid);

  const result = db.transaction(() => {
    const eco = db.get('SELECT * FROM economy WHERE jid = ?', [jid]);
    const lastDaily = Number(eco?.last_daily || 0);
    const elapsed = now - lastDaily;

    if (lastDaily > 0 && elapsed < DAY_MS) {
      return {
        ok: false,
        remainingMs: DAY_MS - elapsed,
      };
    }

    // Streak berlanjut bila diklaim sebelum lewat 48 jam sejak klaim terakhir
    const prevStreak = Number(eco?.daily_streak || 0);
    const nextStreak = lastDaily > 0 && elapsed < DAY_MS * 2 ? prevStreak + 1 : 1;

    const baseReward = Number(config.economy.dailyReward || 350);
    const streakBonus = Math.min(250, (nextStreak - 1) * 25);
    const rawTotal = baseReward + streakBonus;
    const finalCoins = prem.isPremium
      ? Math.round(rawTotal * (config.economy.premiumBonusMultiplier || 1.25))
      : rawTotal;
    const xpGain = prem.isPremium ? 65 : 45;

    db.run(
      `UPDATE economy
       SET balance = balance + ?,
           total_earned = total_earned + ?,
           daily_streak = ?,
           last_daily = ?,
           updated_at = ?
       WHERE jid = ?`,
      [finalCoins, finalCoins, nextStreak, now, now, jid]
    );

    const updated = db.get('SELECT balance FROM economy WHERE jid = ?', [jid]);
    return {
      ok: true,
      reward: finalCoins,
      streakBonus,
      streak: nextStreak,
      xpGain,
      isPremium: prem.isPremium,
      newBalance: Number(updated?.balance || 0),
    };
  });

  if (result.ok) {
    result.xpResult = addXp(jid, result.xpGain);
  }
  return result;
}

/**
 * Klaim hadiah mingguan (.weekly) dengan bonus VIP
 * @param {string} rawJid
 * @param {string} [pushName]
 */
function claimWeekly(rawJid, pushName = '') {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid, pushName);
  const db = getDb();
  const now = Date.now();
  const prem = getPremiumStatus(jid);

  const result = db.transaction(() => {
    const eco = db.get('SELECT * FROM economy WHERE jid = ?', [jid]);
    const lastWeekly = Number(eco?.last_weekly || 0);
    const elapsed = now - lastWeekly;

    if (lastWeekly > 0 && elapsed < WEEK_MS) {
      return {
        ok: false,
        remainingMs: WEEK_MS - elapsed,
      };
    }

    const baseReward = Number(config.economy.weeklyReward || 2500);
    const finalCoins = prem.isPremium
      ? Math.round(baseReward * (config.economy.premiumBonusMultiplier || 1.25))
      : baseReward;
    const xpGain = prem.isPremium ? 220 : 160;

    db.run(
      `UPDATE economy
       SET balance = balance + ?,
           total_earned = total_earned + ?,
           last_weekly = ?,
           updated_at = ?
       WHERE jid = ?`,
      [finalCoins, finalCoins, now, now, jid]
    );

    const updated = db.get('SELECT balance FROM economy WHERE jid = ?', [jid]);
    return {
      ok: true,
      reward: finalCoins,
      xpGain,
      isPremium: prem.isPremium,
      newBalance: Number(updated?.balance || 0),
    };
  });

  if (result.ok) {
    result.xpResult = addXp(jid, result.xpGain);
  }
  return result;
}

/**
 * Bekerja mencari Sakura Coin (.kerja) dengan cerita acak kawaii
 * @param {string} rawJid
 * @param {string} [pushName]
 */
function doWork(rawJid, pushName = '') {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid, pushName);
  const db = getDb();
  const now = Date.now();
  const prem = getPremiumStatus(jid);

  const baseCd = Number(config.economy.workCooldownMs || 30 * 60 * 1000);
  const cooldownMs = prem.isPremium ? Math.round(baseCd * 0.65) : baseCd;

  const result = db.transaction(() => {
    const eco = db.get('SELECT * FROM economy WHERE jid = ?', [jid]);
    const lastWork = Number(eco?.last_work || 0);
    const elapsed = now - lastWork;

    if (lastWork > 0 && elapsed < cooldownMs) {
      return {
        ok: false,
        remainingMs: cooldownMs - elapsed,
      };
    }

    const minCoin = Number(config.economy.workMin || 120);
    const maxCoin = Number(config.economy.workMax || 420);
    const rolled = Math.floor(Math.random() * (maxCoin - minCoin + 1)) + minCoin;
    const finalCoins = prem.isPremium
      ? Math.round(rolled * (config.economy.premiumBonusMultiplier || 1.25))
      : rolled;
    const xpGain = prem.isPremium ? 35 : 25;
    const job = KAWAII_JOBS[Math.floor(Math.random() * KAWAII_JOBS.length)];

    db.run(
      `UPDATE economy
       SET balance = balance + ?,
           total_earned = total_earned + ?,
           last_work = ?,
           updated_at = ?
       WHERE jid = ?`,
      [finalCoins, finalCoins, now, now, jid]
    );

    const updated = db.get('SELECT balance FROM economy WHERE jid = ?', [jid]);
    return {
      ok: true,
      job,
      reward: finalCoins,
      xpGain,
      isPremium: prem.isPremium,
      newBalance: Number(updated?.balance || 0),
    };
  });

  if (result.ok) {
    result.xpResult = addXp(jid, result.xpGain);
  }
  return result;
}

/**
 * Transfer Sakura Coin antar user secara atomik
 * @param {string} fromRawJid
 * @param {string} toRawJid
 * @param {number} amount
 */
function transferCoins(fromRawJid, toRawJid, amount) {
  const fromJid = normalizeUserJid(fromRawJid);
  const toJid = normalizeUserJid(toRawJid);
  const cleanAmount = Math.floor(Number(amount || 0));
  const minTx = Number(config.economy.minTransfer || 10);

  if (!fromJid || !toJid) {
    return { ok: false, reason: 'invalid_target' };
  }
  if (fromJid === toJid) {
    return { ok: false, reason: 'self_transfer' };
  }
  if (!Number.isFinite(cleanAmount) || cleanAmount < minTx) {
    return { ok: false, reason: 'below_minimum', minTx };
  }

  ensureUser(fromJid);
  ensureUser(toJid);

  const db = getDb();
  const now = Date.now();

  const res = db.transaction(() => {
    const senderEco = db.get('SELECT balance FROM economy WHERE jid = ?', [fromJid]);
    const senderBal = Number(senderEco?.balance || 0);
    if (senderBal < cleanAmount) {
      return { ok: false, reason: 'insufficient_funds', senderBalance: senderBal };
    }

    db.run(
      `UPDATE economy
       SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ?
       WHERE jid = ?`,
      [cleanAmount, cleanAmount, now, fromJid]
    );
    db.run(
      `UPDATE economy
       SET balance = balance + ?, total_earned = total_earned + ?, updated_at = ?
       WHERE jid = ?`,
      [cleanAmount, cleanAmount, now, toJid]
    );

    const nextSender = db.get('SELECT balance FROM economy WHERE jid = ?', [fromJid]);
    const nextReceiver = db.get('SELECT balance FROM economy WHERE jid = ?', [toJid]);

    return {
      ok: true,
      amount: cleanAmount,
      senderBalance: Number(nextSender?.balance || 0),
      receiverBalance: Number(nextReceiver?.balance || 0),
    };
  });

  if (res.ok) {
    addAuditLog({
      level: 'info',
      category: 'economy',
      actorJid: fromJid,
      target: toJid,
      action: 'transfer_coins',
      details: { amount: cleanAmount },
    });
  }

  return res;
}

/**
 * Ambil daftar Top Leaderboard (saldo atau level) beserta posisi pemanggil
 * @param {'saldo'|'level'} mode
 * @param {string} [callerRawJid]
 * @param {number} [limit=10]
 */
function getLeaderboardData(mode = 'saldo', callerRawJid = '', limit = 10) {
  const db = getDb();
  const callerJid = callerRawJid ? normalizeUserJid(callerRawJid) : '';

  if (mode === 'level') {
    const rows = db.all(
      `SELECT u.jid, u.name, u.level, u.xp, u.title, COALESCE(e.balance, 0) AS balance
       FROM users u
       LEFT JOIN economy e ON e.jid = u.jid
       WHERE u.is_banned = 0
       ORDER BY u.level DESC, u.xp DESC, u.created_at ASC
       LIMIT ?`,
      [limit]
    );

    let callerRank = null;
    if (callerJid) {
      const me = db.get('SELECT level, xp FROM users WHERE jid = ?', [callerJid]);
      if (me) {
        const higher = db.get(
          `SELECT COUNT(*) AS cnt FROM users
           WHERE is_banned = 0 AND (level > ? OR (level = ? AND xp > ?))`,
          [me.level, me.level, me.xp]
        );
        callerRank = Number(higher?.cnt || 0) + 1;
      }
    }

    return {
      mode: 'level',
      rows: rows.map((r) => ({
        jid: r.jid,
        name: r.name || 'Sahabat Cipi',
        level: Number(r.level || 1),
        xp: Number(r.xp || 0),
        balance: Number(r.balance || 0),
        title: r.title || 'Petualang',
      })),
      callerRank,
    };
  }

  // Default: mode 'saldo' (total kekayaan dompet + bank)
  const rows = db.all(
    `SELECT u.jid, u.name, u.level, u.xp,
            COALESCE(e.balance, 0) AS balance,
            COALESCE(e.bank, 0) AS bank,
            (COALESCE(e.balance, 0) + COALESCE(e.bank, 0)) AS net_worth
     FROM economy e
     INNER JOIN users u ON u.jid = e.jid
     WHERE u.is_banned = 0
     ORDER BY net_worth DESC, u.level DESC, u.created_at ASC
     LIMIT ?`,
    [limit]
  );

  let callerRank = null;
  if (callerJid) {
    const me = db.get(
      'SELECT (COALESCE(balance, 0) + COALESCE(bank, 0)) AS nw FROM economy WHERE jid = ?',
      [callerJid]
    );
    if (me !== undefined) {
      const myNw = Number(me.nw || 0);
      const higher = db.get(
        `SELECT COUNT(*) AS cnt
         FROM economy e
         INNER JOIN users u ON u.jid = e.jid
         WHERE u.is_banned = 0 AND (COALESCE(e.balance, 0) + COALESCE(e.bank, 0)) > ?`,
        [myNw]
      );
      callerRank = Number(higher?.cnt || 0) + 1;
    }
  }

  return {
    mode: 'saldo',
    rows: rows.map((r) => ({
      jid: r.jid,
      name: r.name || 'Sahabat Cipi',
      level: Number(r.level || 1),
      balance: Number(r.balance || 0),
      bank: Number(r.bank || 0),
      netWorth: Number(r.net_worth || 0),
    })),
    callerRank,
  };
}

module.exports = {
  KAWAII_JOBS,
  formatCountdown,
  getEconomy,
  addBalance,
  deductBalance,
  claimDaily,
  claimWeekly,
  doWork,
  transferCoins,
  getLeaderboardData,
};
