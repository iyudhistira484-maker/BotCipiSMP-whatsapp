const fs = require('fs');
const path = require('path');
const pino = require('pino');
const config = require('../config');

fs.mkdirSync(config.paths.logsDir, { recursive: true });

const SECRET_ENV_KEYS = [
  'PTERO_CLIENT_API_KEY',
  'RCON_PASSWORD',
  'DISCORD_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'AI_API_KEY',
  'PANEL_PASSWORD',
  'PANEL_SESSION_SECRET',
];

const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Ambil komponen waktu saat ini dalam zona waktu Asia/Jakarta (WIB)
 * @param {Date} [date]
 */
function getWibParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone || 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }
  const hourNum = Number(parts.hour || 0) % 24;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: String(hourNum).padStart(2, '0'),
    minute: parts.minute,
    second: parts.second,
    hourNum,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timestamp: `${parts.year}-${parts.month}-${parts.day} ${String(hourNum).padStart(2, '0')}:${parts.minute}:${parts.second} WIB`,
  };
}

/**
 * Tanggal hari ini format YYYY-MM-DD sesuai WIB (untuk reset tengah malam WIB)
 * @param {Date} [date]
 * @returns {string}
 */
function getWibDateKey(date = new Date()) {
  return getWibParts(date).dateKey;
}

/**
 * Ucapan waktu otomatis sesuai jam WIB
 * @param {Date} [date]
 * @returns {{ greeting: string, emoji: string, period: string }}
 */
function getWibGreeting(date = new Date()) {
  const { hourNum } = getWibParts(date);
  if (hourNum >= 4 && hourNum < 11) {
    return { greeting: 'Selamat Pagi', emoji: '🌸', period: 'pagi' };
  }
  if (hourNum >= 11 && hourNum < 15) {
    return { greeting: 'Selamat Siang', emoji: '☀️', period: 'siang' };
  }
  if (hourNum >= 15 && hourNum < 18) {
    return { greeting: 'Selamat Sore', emoji: '🌷', period: 'sore' };
  }
  return { greeting: 'Selamat Malam', emoji: '🌙', period: 'malam' };
}

/**
 * Format durasi milidetik menjadi teks ringkas (contoh: 2h 14j 30m 12d)
 * @param {number} ms
 * @returns {string}
 */
function formatUptime(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}h`);
  if (hours > 0 || days > 0) parts.push(`${hours}j`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}d`);
  return parts.join(' ');
}

/**
 * Format angka ribuan bergaya Indonesia
 * @param {number} amount
 * @returns {string}
 */
function formatNumber(amount) {
  return Number(amount || 0).toLocaleString('id-ID');
}

/**
 * Sensor token/key rahasia agar tidak pernah bocor di log atau file error
 * @param {unknown} input
 * @returns {string}
 */
function redactSecrets(input) {
  let text = '';
  if (input instanceof Error) {
    text = `${input.name}: ${input.message}${input.stack ? `\n${input.stack}` : ''}`;
  } else if (typeof input === 'object' && input !== null) {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  } else {
    text = String(input ?? '');
  }

  for (const envKey of SECRET_ENV_KEYS) {
    const val = process.env[envKey];
    if (val && val.length >= 6) {
      text = text.split(val).join('[REDACTED]');
    }
  }

  // Sensor pola token umum (Bearer, webhook Discord, API key query)
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/gi, 'discord.com/api/webhooks/[REDACTED]')
    .replace(/([?&](?:key|api_key|token|password)=)[^&\s]+/gi, '$1[REDACTED]');

  return text;
}

function shouldLog(level) {
  const configured = LEVEL_PRIORITY[String(config.logLevel || 'info').toLowerCase()] || LEVEL_PRIORITY.info;
  const target = LEVEL_PRIORITY[level] || LEVEL_PRIORITY.info;
  return target >= configured;
}

function appendErrorFile(tag, message, detail) {
  try {
    const errFile = path.join(config.paths.logsDir, 'error.log');
    const line = `[${getWibParts().timestamp}] [${tag}] ${redactSecrets(message)}${
      detail ? ` | ${redactSecrets(detail)}` : ''
    }\n`;
    fs.appendFileSync(errFile, line, 'utf8');
  } catch {
    // Jangan biarkan kegagalan tulis log menghentikan bot
  }
}

const CONSOLE_BUFFER_MAX = 300;
let consoleSeq = 0;
const consoleBuffer = [];
const consoleSubscribers = new Set();

function pushConsoleEntry(level, scope, message) {
  const ts = getWibParts().timestamp;
  const entry = {
    id: ++consoleSeq,
    epoch: Date.now(),
    ts,
    level,
    scope: String(scope || 'SYS'),
    message: String(message || ''),
  };
  consoleBuffer.push(entry);
  if (consoleBuffer.length > CONSOLE_BUFFER_MAX) {
    consoleBuffer.shift();
  }
  for (const fn of consoleSubscribers) {
    try {
      fn(entry);
    } catch {
      // Jangan biarkan subscriber panel mengganggu logger utama
    }
  }
  return entry;
}

function getConsoleBuffer(limit = 200) {
  const n = Math.max(1, Math.min(CONSOLE_BUFFER_MAX, Number(limit) || 200));
  return consoleBuffer.slice(-n);
}

function subscribeConsoleLogs(listener) {
  if (typeof listener !== 'function') return () => {};
  consoleSubscribers.add(listener);
  return () => consoleSubscribers.delete(listener);
}

const logger = {
  debug(scope, message, meta) {
    if (!shouldLog('debug')) return;
    const extra = meta !== undefined ? ` — ${redactSecrets(meta)}` : '';
    const clean = `${redactSecrets(message)}${extra}`;
    const entry = pushConsoleEntry('debug', scope, clean);
    console.log(`[${entry.ts}] [DEBUG] [${scope}] ${clean}`);
  },

  info(scope, message, meta) {
    if (!shouldLog('info')) return;
    const extra = meta !== undefined ? ` — ${redactSecrets(meta)}` : '';
    const clean = `${redactSecrets(message)}${extra}`;
    const entry = pushConsoleEntry('info', scope, clean);
    console.log(`[${entry.ts}] [✦ INFO] [${scope}] ${clean}`);
  },

  warn(scope, message, meta) {
    if (!shouldLog('warn')) return;
    const extra = meta !== undefined ? ` — ${redactSecrets(meta)}` : '';
    const clean = `${redactSecrets(message)}${extra}`;
    const entry = pushConsoleEntry('warn', scope, clean);
    console.warn(`[${entry.ts}] [⚠ WARN] [${scope}] ${clean}`);
  },

  error(scope, message, err) {
    const cleanMsg = redactSecrets(message);
    const cleanErr = err !== undefined ? redactSecrets(err) : '';
    const combined = `${cleanMsg}${cleanErr ? ` | ${cleanErr}` : ''}`;
    const entry = pushConsoleEntry('error', scope, combined);
    console.error(`[${entry.ts}] [❌ ERROR] [${scope}] ${cleanMsg}${cleanErr ? `\n  ↳ ${cleanErr}` : ''}`);
    appendErrorFile(scope, cleanMsg, cleanErr);
  },

  cmd({ sender, cmdName, isGroup, status, ms }) {
    if (!shouldLog('info')) return;
    const chatLabel = isGroup ? 'GRUP' : 'PVT';
    const line = `${cmdName} oleh ${sender} -> ${status} (${ms}ms)`;
    const entry = pushConsoleEntry('cmd', chatLabel, line);
    console.log(`[${entry.ts}] [✿ CMD] [${chatLabel}] ${line}`);
  },
};

/**
 * Logger khusus internal Baileys (level fatal/silent agar terminal tetap bersih)
 */
const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || 'silent',
});

module.exports = {
  logger,
  baileysLogger,
  redactSecrets,
  getWibParts,
  getWibDateKey,
  getWibGreeting,
  formatUptime,
  formatNumber,
  getConsoleBuffer,
  subscribeConsoleLogs,
  pushConsoleEntry,
};
