const fs = require('fs');
const os = require('os');
const util = require('util');
const vm = require('vm');
const config = require('../config');
const {
  getDb,
  getDriverName,
  ensureUser,
  normalizeUserJid,
  extractPhoneFromJid,
  isOwner,
  getSetting,
  setSetting,
  addAuditLog,
} = require('./database');
const { createBackup } = require('./backup');
const { getWibParts, formatUptime, logger } = require('./logger');

let detectedCardEngine = 'sharp (SVG fallback)';
try {
  require('@napi-rs/canvas');
  detectedCardEngine = '@napi-rs/canvas + sharp';
} catch {
  detectedCardEngine = 'sharp (SVG fallback)';
}

/**
 * Format timestamp milidetik menjadi teks tanggal & jam WIB yang rapi
 */
function formatTimestampWib(epochMs) {
  if (!epochMs || !Number.isFinite(Number(epochMs))) return '-';
  return getWibParts(new Date(Number(epochMs))).timestamp;
}

/**
 * Resolusi target JID dari @mention, pesan yang di-reply, atau argumen nomor telepon (08xx / 628xx)
 */
function resolveTargetUserJid(ctx, rawArg = '') {
  if (ctx?.mentionedJids && ctx.mentionedJids.length > 0) {
    return normalizeUserJid(ctx.mentionedJids[0]);
  }
  if (ctx?.quotedSenderJid) {
    return normalizeUserJid(ctx.quotedSenderJid);
  }
  const cleaned = String(rawArg || '').trim();
  if (!cleaned) return '';

  if (cleaned.endsWith('@s.whatsapp.net')) {
    return normalizeUserJid(cleaned);
  }

  let digits = cleaned.replace(/[^0-9]/g, '');
  if (digits.startsWith('08')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8') && digits.length >= 9) {
    digits = `62${digits}`;
  }

  if (digits.length < 7 || digits.length > 16) return '';
  return `${digits}@s.whatsapp.net`;
}

// =====================================================================
// 1. MANAJEMEN BAN & UNBAN USER
// =====================================================================

function banUser({ actorJid, targetRawJid, reason = '' }) {
  const targetJid = normalizeUserJid(targetRawJid);
  if (!targetJid) return { ok: false, reason: 'invalid_target' };

  if (isOwner(targetJid)) {
    return { ok: false, reason: 'cannot_ban_owner', targetJid };
  }

  const user = ensureUser(targetJid);
  const cleanReason =
    String(reason || '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 160) || 'Melanggar ketentuan komunitas CipiSMP';

  const now = Date.now();
  getDb().run(
    'UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = ? WHERE jid = ?',
    [cleanReason, now, targetJid]
  );

  addAuditLog({
    level: 'warn',
    category: 'owner_admin',
    actorJid: normalizeUserJid(actorJid),
    target: targetJid,
    action: 'ban_user',
    details: { reason: cleanReason },
  });

  return {
    ok: true,
    targetJid,
    phone: extractPhoneFromJid(targetJid),
    name: user?.name || 'Sahabat Cipi',
    banReason: cleanReason,
  };
}

function unbanUser({ actorJid, targetRawJid }) {
  const targetJid = normalizeUserJid(targetRawJid);
  if (!targetJid) return { ok: false, reason: 'invalid_target' };

  const user = ensureUser(targetJid);
  const wasBanned = Boolean(user?.is_banned);

  getDb().run(
    "UPDATE users SET is_banned = 0, ban_reason = '', updated_at = ? WHERE jid = ?",
    [Date.now(), targetJid]
  );

  addAuditLog({
    level: 'info',
    category: 'owner_admin',
    actorJid: normalizeUserJid(actorJid),
    target: targetJid,
    action: 'unban_user',
    details: { wasBanned },
  });

  return {
    ok: true,
    wasBanned,
    targetJid,
    phone: extractPhoneFromJid(targetJid),
    name: user?.name || 'Sahabat Cipi',
  };
}

function listBannedUsers() {
  return getDb().all(
    'SELECT jid, phone, name, ban_reason, updated_at FROM users WHERE is_banned = 1 ORDER BY updated_at DESC'
  );
}

// =====================================================================
// 2. MODE AKSES BOT (.self / .public) & MODE MAINTENANCE (.maintenance)
// =====================================================================

function getBotOperationalState() {
  return {
    botMode: getSetting('bot_mode', 'public'),
    maintenance: getSetting('maintenance', 'false') === 'true',
    maintenanceReason: getSetting(
      'maintenance_reason',
      'Bot sedang dalam perawatan rutin ♡'
    ),
    dryRun: Boolean(config.dryRun),
    useButtons: Boolean(config.useButtons),
    enableOwnerEval: Boolean(config.enableOwnerEval),
  };
}

function setBotAccessMode({ actorJid, mode }) {
  const normalized = mode === 'self' ? 'self' : 'public';
  setSetting('bot_mode', normalized);

  addAuditLog({
    level: 'info',
    category: 'owner_admin',
    actorJid: normalizeUserJid(actorJid),
    target: 'bot_mode',
    action: `set_mode_${normalized}`,
    details: { mode: normalized },
  });

  return { ok: true, mode: normalized };
}

function setMaintenanceState({ actorJid, enabled, reason = '' }) {
  const isOn = Boolean(enabled);
  const cleanReason =
    String(reason || '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 180) || 'Bot sedang dalam perawatan rutin ♡';

  setSetting('maintenance', isOn ? 'true' : 'false');
  if (isOn) {
    setSetting('maintenance_reason', cleanReason);
  }

  addAuditLog({
    level: isOn ? 'warn' : 'info',
    category: 'owner_admin',
    actorJid: normalizeUserJid(actorJid),
    target: 'maintenance',
    action: isOn ? 'maintenance_on' : 'maintenance_off',
    details: { reason: isOn ? cleanReason : '' },
  });

  return {
    ok: true,
    enabled: isOn,
    reason: cleanReason,
  };
}

// =====================================================================
// 3. MANAJEMEN PREMIUM / SAKURA VIP (.addprem, .delprem, .listprem)
// =====================================================================

const MAX_VIP_DURATION_MS = 3650 * 24 * 60 * 60 * 1000; // 10 tahun

function parseVipDurationMs(rawInput = '') {
  const s = String(rawInput || '').toLowerCase().trim();
  if (!s) return null;

  if (['permanen', 'permanent', 'lifetime', 'selamanya'].includes(s)) {
    return {
      ms: MAX_VIP_DURATION_MS,
      label: 'Permanen (3.650 Hari)',
    };
  }

  const m = /^(\d+)\s*(m|menit|h|j|jam|d|hari|w|minggu|mo|bln|bulan|y|thn|tahun)?$/i.exec(s);
  if (!m) return null;

  const num = Number(m[1]);
  const unit = (m[2] || 'd').toLowerCase();
  if (!Number.isFinite(num) || num <= 0) return null;

  let ms = 0;
  let unitLabel = 'Hari';

  if (['m', 'menit'].includes(unit)) {
    ms = num * 60 * 1000;
    unitLabel = 'Menit';
  } else if (['h', 'j', 'jam'].includes(unit)) {
    ms = num * 60 * 60 * 1000;
    unitLabel = 'Jam';
  } else if (['w', 'minggu'].includes(unit)) {
    ms = num * 7 * 24 * 60 * 60 * 1000;
    unitLabel = 'Minggu';
  } else if (['mo', 'bln', 'bulan'].includes(unit)) {
    ms = num * 30 * 24 * 60 * 60 * 1000;
    unitLabel = 'Bulan';
  } else if (['y', 'thn', 'tahun'].includes(unit)) {
    ms = num * 365 * 24 * 60 * 60 * 1000;
    unitLabel = 'Tahun';
  } else {
    ms = num * 24 * 60 * 60 * 1000;
    unitLabel = 'Hari';
  }

  const clampedMs = Math.min(MAX_VIP_DURATION_MS, Math.max(60 * 1000, ms));
  return {
    ms: clampedMs,
    label: `${num} ${unitLabel}`,
  };
}

function grantPremium({ actorJid, targetRawJid, durationInput, tier = 'sakura', note = '' }) {
  const targetJid = normalizeUserJid(targetRawJid);
  if (!targetJid) return { ok: false, reason: 'invalid_target' };

  const parsed = parseVipDurationMs(durationInput);
  if (!parsed) return { ok: false, reason: 'invalid_duration' };

  const user = ensureUser(targetJid);
  const db = getDb();
  const now = Date.now();
  const existing = db.get('SELECT * FROM premium WHERE jid = ?', [targetJid]);

  const wasActive = Boolean(existing && existing.active && Number(existing.expires_at) > now);
  const baseTime = wasActive ? Number(existing.expires_at) : now;
  const expiresAt = Math.min(now + MAX_VIP_DURATION_MS, baseTime + parsed.ms);
  const cleanNote = String(note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
  const actorNorm = normalizeUserJid(actorJid) || 'owner';

  if (!existing) {
    db.run(
      `INSERT INTO premium (jid, tier, expires_at, granted_by, note, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [targetJid, tier, expiresAt, actorNorm, cleanNote, now, now]
    );
  } else {
    db.run(
      `UPDATE premium
       SET tier = ?, expires_at = ?, granted_by = ?, note = ?, active = 1, updated_at = ?
       WHERE jid = ?`,
      [tier, expiresAt, actorNorm, cleanNote || existing.note || '', now, targetJid]
    );
  }

  addAuditLog({
    level: 'info',
    category: 'premium',
    actorJid: actorNorm,
    target: targetJid,
    action: wasActive ? 'extend_premium' : 'grant_premium',
    details: {
      durationLabel: parsed.label,
      expiresAt,
      note: cleanNote,
    },
  });

  return {
    ok: true,
    wasExtended: wasActive,
    targetJid,
    phone: extractPhoneFromJid(targetJid),
    name: user?.name || 'Sahabat Cipi',
    tier,
    durationLabel: parsed.label,
    expiresAt,
    expiresWib: formatTimestampWib(expiresAt),
    note: cleanNote,
  };
}

function revokePremium({ actorJid, targetRawJid }) {
  const targetJid = normalizeUserJid(targetRawJid);
  if (!targetJid) return { ok: false, reason: 'invalid_target' };

  const db = getDb();
  const now = Date.now();
  const existing = db.get('SELECT * FROM premium WHERE jid = ?', [targetJid]);
  const wasActive = Boolean(existing && existing.active && Number(existing.expires_at) > now);

  if (existing) {
    db.run('UPDATE premium SET active = 0, expires_at = ?, updated_at = ? WHERE jid = ?', [
      now,
      now,
      targetJid,
    ]);
  }

  const user = ensureUser(targetJid);
  addAuditLog({
    level: 'warn',
    category: 'premium',
    actorJid: normalizeUserJid(actorJid),
    target: targetJid,
    action: 'revoke_premium',
    details: { wasActive },
  });

  return {
    ok: true,
    wasActive,
    targetJid,
    phone: extractPhoneFromJid(targetJid),
    name: user?.name || 'Sahabat Cipi',
  };
}

function listActivePremiumUsers() {
  const db = getDb();
  const now = Date.now();
  db.run('UPDATE premium SET active = 0, updated_at = ? WHERE active = 1 AND expires_at <= ?', [
    now,
    now,
  ]);

  const rows = db.all(
    `SELECT p.jid, p.tier, p.expires_at, p.granted_by, p.note, p.created_at,
            u.name, u.phone, u.level
     FROM premium p
     LEFT JOIN users u ON u.jid = p.jid
     WHERE p.active = 1 AND p.expires_at > ?
     ORDER BY p.expires_at ASC`,
    [now]
  );

  return rows.map((r) => {
    const msLeft = Math.max(0, Number(r.expires_at) - now);
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    return {
      ...r,
      phone: r.phone || extractPhoneFromJid(r.jid),
      name: r.name || 'Sahabat Cipi',
      daysLeft,
      expiresWib: formatTimestampWib(r.expires_at),
    };
  });
}

// =====================================================================
// 4. DIAGNOSTIK SISTEM, LOG AUDIT & RESTART PROSES BOT
// =====================================================================

function getSystemDiagnostics(commandsCount = 0) {
  const db = getDb();
  const now = Date.now();
  const countOf = (sql, params = []) => Number(db.get(sql, params)?.cnt || 0);

  let dbSizeKb = 0;
  try {
    if (fs.existsSync(config.paths.databaseFile)) {
      dbSizeKb = Math.round(fs.statSync(config.paths.databaseFile).size / 1024);
    }
  } catch {
    dbSizeKb = 0;
  }

  const mem = process.memoryUsage();
  return {
    uptimeText: formatUptime(process.uptime()),
    ramRssMb: (mem.rss / 1024 / 1024).toFixed(1),
    heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.arch()}`,
    sqliteDriver: getDriverName(),
    cardEngine: detectedCardEngine,
    dbSizeKb,
    commandsCount,
    usersCount: countOf('SELECT COUNT(*) AS cnt FROM users'),
    bannedCount: countOf('SELECT COUNT(*) AS cnt FROM users WHERE is_banned = 1'),
    groupsCount: countOf('SELECT COUNT(*) AS cnt FROM groups'),
    linkedMcCount: countOf("SELECT COUNT(*) AS cnt FROM links WHERE status = 'linked'"),
    activeVipCount: countOf(
      'SELECT COUNT(*) AS cnt FROM premium WHERE active = 1 AND expires_at > ?',
      [now]
    ),
    openTicketsCount: countOf("SELECT COUNT(*) AS cnt FROM tickets WHERE status = 'open'"),
    operational: getBotOperationalState(),
  };
}

function getRecentAuditLogs(limit = 10, categoryFilter = '') {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 10)));
  const cat = String(categoryFilter || '').toLowerCase().trim();
  const db = getDb();

  const rows = cat
    ? db.all(
        'SELECT * FROM logs WHERE LOWER(category) = ? ORDER BY id DESC LIMIT ?',
        [cat, safeLimit]
      )
    : db.all('SELECT * FROM logs ORDER BY id DESC LIMIT ?', [safeLimit]);

  return rows.map((r) => ({
    ...r,
    actorJid: r.actor_jid,
    timeWib: formatTimestampWib(r.created_at),
  }));
}

async function triggerGracefulBotRestart({ actorJid }) {
  const actorNorm = normalizeUserJid(actorJid);
  let backupFile = null;
  try {
    const bkp = await createBackup('pre-restart');
    backupFile = bkp?.fileName || null;
  } catch (err) {
    logger.warn('RESTART', `Gagal membuat backup pra-restart: ${err.message}`);
  }

  addAuditLog({
    level: 'warn',
    category: 'owner_admin',
    actorJid: actorNorm,
    target: 'process',
    action: 'restart_bot_process',
    details: { dryRun: config.dryRun, backupFile },
  });

  if (config.dryRun) {
    return { ok: true, simulated: true, backupFile };
  }

  const timer = setTimeout(() => {
    logger.warn('RESTART', 'Menutup proses untuk di-restart otomatis oleh PM2 / Panel...');
    process.exit(0);
  }, 1500);
  if (typeof timer.unref === 'function') timer.unref();

  return { ok: true, simulated: false, backupFile };
}

// =====================================================================
// 5. CONTROLLED & SAFE OWNER EVAL (.eval) DENGAN SANDBOX VM & REDAKSI SECRET
// =====================================================================

function collectSensitiveValues() {
  const secrets = new Set();
  const addVal = (v) => {
    const s = String(v || '').trim();
    if (s.length >= 4) secrets.add(s);
  };

  addVal(config.pterodactyl?.clientApiKey);
  addVal(config.rcon?.password);
  addVal(config.discord?.webhookUrl);
  addVal(config.discord?.botToken);
  addVal(config.ai?.apiKey);
  addVal(config.downloader?.apiKey);

  for (const [k, v] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD|WEBHOOK|AUTH|COOKIE)/i.test(k)) {
      addVal(v);
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length);
}

function redactSecrets(rawText = '') {
  let out = String(rawText ?? '');
  for (const sec of collectSensitiveValues()) {
    out = out.split(sec).join('[REDACTED_SECRET]');
  }
  return out;
}

function createRedactedConfigSnapshot() {
  const clone = JSON.parse(JSON.stringify(config));
  if (clone.pterodactyl) clone.pterodactyl.clientApiKey = '[REDACTED]';
  if (clone.rcon) clone.rcon.password = '[REDACTED]';
  if (clone.discord) {
    clone.discord.webhookUrl = '[REDACTED]';
    clone.discord.botToken = '[REDACTED]';
  }
  if (clone.ai) clone.ai.apiKey = '[REDACTED]';
  if (clone.downloader) clone.downloader.apiKey = '[REDACTED]';
  return Object.freeze(clone);
}

/**
 * Jalankan kode diagnostik JS khusus Owner di dalam VM terisolasi:
 * - Wajib Owner + wajib ENABLE_OWNER_EVAL=true di .env
 * - Tanpa akses require / child_process / fs / process.env mentah
 * - DB hanya terekspos mode baca (db.get & db.all)
 * - Timeout ketat (3 detik sinkron, 5 detik async) + redaksi seluruh rahasia otomatis
 */
async function executeControlledEval({ actorJid, code = '', meta = {} }) {
  const actorNorm = normalizeUserJid(actorJid);

  if (!isOwner(actorNorm)) {
    addAuditLog({
      level: 'error',
      category: 'owner_eval',
      actorJid: actorNorm,
      target: 'vm_sandbox',
      action: 'eval_unauthorized_blocked',
      details: {},
    });
    return { ok: false, reason: 'not_owner' };
  }

  if (!config.enableOwnerEval) {
    addAuditLog({
      level: 'warn',
      category: 'owner_eval',
      actorJid: actorNorm,
      target: 'vm_sandbox',
      action: 'eval_disabled_by_config',
      details: { length: String(code || '').length },
    });
    return { ok: false, reason: 'eval_disabled' };
  }

  const trimmedCode = String(code || '').trim();
  if (!trimmedCode) {
    return { ok: false, reason: 'empty_code' };
  }

  // Blokir pola berbahaya (eksekusi shell OS, hapus file, baca process.env mentah, prototype escape)
  const dangerousPattern =
    /\b(child_process|execSync|execFile|spawnSync|rmSync|unlinkSync|rmdirSync|writeFileSync|process\.env|process\.exit)\b|\bconstructor\b|__proto__/;
  if (dangerousPattern.test(trimmedCode)) {
    addAuditLog({
      level: 'error',
      category: 'owner_eval',
      actorJid: actorNorm,
      target: 'vm_sandbox',
      action: 'eval_dangerous_pattern_blocked',
      details: { codePreview: redactSecrets(trimmedCode).slice(0, 120) },
    });
    return { ok: false, reason: 'blocked_pattern' };
  }

  const db = getDb();
  const readOnlyDb = Object.freeze({
    driver: getDriverName(),
    get: (sql, params = []) => {
      if (!/^\s*SELECT\b/i.test(String(sql || ''))) {
        throw new Error('Sandbox db.get hanya mengizinkan query SELECT');
      }
      return db.get(sql, params);
    },
    all: (sql, params = []) => {
      if (!/^\s*SELECT\b/i.test(String(sql || ''))) {
        throw new Error('Sandbox db.all hanya mengizinkan query SELECT');
      }
      return db.all(sql, params);
    },
  });

  const logsCollected = [];
  const safeConsole = Object.freeze({
    log: (...items) => logsCollected.push(items.map((x) => util.inspect(x, { depth: 2 })).join(' ')),
    info: (...items) => logsCollected.push(items.map((x) => util.inspect(x, { depth: 2 })).join(' ')),
    warn: (...items) => logsCollected.push(items.map((x) => util.inspect(x, { depth: 2 })).join(' ')),
  });

  const sandbox = {
    console: safeConsole,
    config: createRedactedConfigSnapshot(),
    db: readOnlyDb,
    stats: () => getSystemDiagnostics(meta.commandsCount || 0),
    wib: () => getWibParts(),
    senderJid: actorNorm,
    chatJid: meta.chatJid || '',
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Map,
    Set,
    Promise,
  };

  const startedAt = Date.now();
  try {
    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });

    // Coba jalankan sebagai ekspresi terlebih dahulu; bila mengandung statement multi-baris, bungkus async IIFE
    let scriptSource = `(async () => (\n${trimmedCode}\n))()`;
    try {
      // Validasi sintaks ekspresi
      new vm.Script(scriptSource);
    } catch {
      scriptSource = `(async () => {\n${trimmedCode}\n})()`;
    }

    const script = new vm.Script(scriptSource, { filename: 'owner-eval.vm.js' });
    const rawPromise = script.runInContext(context, { timeout: 3000 });

    const value = await Promise.race([
      Promise.resolve(rawPromise),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Batas waktu eksekusi async 5000ms terlampaui')), 5000)
      ),
    ]);

    const formattedValue =
      typeof value === 'string'
        ? value
        : util.inspect(value, { depth: 3, maxArrayLength: 30, breakLength: 72 });

    const combined = [
      ...(logsCollected.length > 0 ? [`[console]\n${logsCollected.join('\n')}`] : []),
      formattedValue,
    ].join('\n\n');

    const safeOutput = redactSecrets(combined).slice(0, 2800);
    const elapsedMs = Date.now() - startedAt;

    addAuditLog({
      level: 'info',
      category: 'owner_eval',
      actorJid: actorNorm,
      target: 'vm_sandbox',
      action: 'eval_executed',
      details: {
        codePreview: redactSecrets(trimmedCode).slice(0, 120),
        elapsedMs,
      },
    });

    return {
      ok: true,
      output: safeOutput,
      elapsedMs,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const safeErr = redactSecrets(err?.message || String(err)).slice(0, 600);

    addAuditLog({
      level: 'warn',
      category: 'owner_eval',
      actorJid: actorNorm,
      target: 'vm_sandbox',
      action: 'eval_error',
      details: {
        codePreview: redactSecrets(trimmedCode).slice(0, 120),
        error: safeErr,
      },
    });

    return {
      ok: false,
      reason: 'runtime_error',
      error: safeErr,
      elapsedMs,
    };
  }
}

module.exports = {
  formatTimestampWib,
  resolveTargetUserJid,
  banUser,
  unbanUser,
  listBannedUsers,
  getBotOperationalState,
  setBotAccessMode,
  setMaintenanceState,
  parseVipDurationMs,
  grantPremium,
  revokePremium,
  listActivePremiumUsers,
  getSystemDiagnostics,
  getRecentAuditLogs,
  triggerGracefulBotRestart,
  redactSecrets,
  executeControlledEval,
};
