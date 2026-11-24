const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('../config');
const {
  getDb,
  getDriverName,
  ensureUser,
  normalizeUserJid,
  extractPhoneFromJid,
  addAuditLog,
} = require('./database');
const { addBalance, deductBalance } = require('./economy');
const { listBackups, createBackup } = require('./backup');
const { fetchMinecraftServerStatus } = require('./api');
const {
  isPteroConfigured,
  isRconConfigured,
  validateWhitelistedConsoleCommand,
  executeMinecraftCommand,
  getServerResources,
  sendPowerSignal,
  createPteroServerBackup,
} = require('./ptero');
const { isDiscordWebhookConfigured, isDiscordBotConfigured } = require('./discord');
const { sanitizeBroadcastInput, executeConfirmedBroadcast } = require('./broadcast');
const {
  listActiveGiveaways,
  listScheduledEvents,
  closeSupportTicket,
} = require('./scheduler');
const {
  formatTimestampWib,
  banUser,
  unbanUser,
  getBotOperationalState,
  setBotAccessMode,
  setMaintenanceState,
  grantPremium,
  revokePremium,
  getSystemDiagnostics,
  getRecentAuditLogs,
  triggerGracefulBotRestart,
} = require('./owner-manager');
const {
  logger,
  getConsoleBuffer,
  subscribeConsoleLogs,
  pushConsoleEntry,
} = require('./logger');
const {
  startTelemetry,
  stopTelemetry,
  getLatestSample,
  getTelemetryHistory,
  subscribeTelemetry,
  measureStorage,
  getStaticHostInfo,
} = require('./telemetry');

const PUBLIC_DIR = path.resolve(__dirname, '../panel/public');

const SQLITE_TABLES = [
  'users',
  'groups',
  'economy',
  'inventory',
  'gacha',
  'pets',
  'tickets',
  'giveaways',
  'events',
  'links',
  'settings',
  'premium',
  'daily_limits',
  'logs',
];

let panelServer = null;
let serverBindInfo = { host: '0.0.0.0', port: 3000 };
const sseClients = new Set();

let runtimeBridge = {
  getSock: () => null,
  getWaState: () => ({ status: 'standalone', botJid: null, pairingCode: null }),
  requestPairing: null,
  connectWa: null,
  disconnectWa: null,
  reloadCommands: null,
  getCommandsInfo: () => ({ commandsCount: 0, aliasesCount: 0 }),
  getCommandsCatalog: () => [],
};

const activeSessionSecret =
  config.panel.sessionSecret || crypto.randomBytes(32).toString('hex');
const generatedStartupPin = crypto.randomBytes(4).toString('hex').toUpperCase();

function getEffectivePanelPassword() {
  return config.panel.password || generatedStartupPin;
}

// Rate-limiter khusus percobaan login gagal per IP
const failedLogins = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 6;

function isLoginRateLimited(ip) {
  const now = Date.now();
  const list = (failedLogins.get(ip) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  failedLogins.set(ip, list);
  return list.length >= MAX_FAILED_ATTEMPTS;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const list = (failedLogins.get(ip) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  list.push(now);
  failedLogins.set(ip, list);
}

function clearFailedLogins(ip) {
  failedLogins.delete(ip);
}

function safeTimingEqual(a = '', b = '') {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createSessionToken(username) {
  const exp = Date.now() + Number(config.panel.sessionTtlMs || 12 * 3600 * 1000);
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', activeSessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token = '') {
  const raw = String(token || '').trim();
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;

  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', activeSessionSecret)
    .update(payload)
    .digest('base64url');

  if (!safeTimingEqual(sig, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || !parsed.exp || Number(parsed.exp) <= Date.now()) return null;
    return { username: parsed.u || 'admin', exp: Number(parsed.exp) };
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const seg of String(header || '').split(';')) {
    const idx = seg.indexOf('=');
    if (idx > 0) {
      const k = seg.slice(0, idx).trim();
      const v = decodeURIComponent(seg.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

function extractSession(req, searchParams = null) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    const tok = verifySessionToken(auth.slice(7).trim());
    if (tok) return tok;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.cp_session) {
    const tok = verifySessionToken(cookies.cp_session);
    if (tok) return tok;
  }
  if (searchParams && searchParams.get('token')) {
    return verifySessionToken(searchParams.get('token'));
  }
  return null;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload melampaui batas 64 KB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const isFontAsset = ext === '.woff2' || ext === '.woff';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': isFontAsset ? 'public, max-age=86400' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

function attachBotRuntimeToPanel(bridge = {}) {
  runtimeBridge = {
    ...runtimeBridge,
    ...bridge,
  };
}

function getSqliteTableStats() {
  const db = getDb();
  const out = [];
  for (const tbl of SQLITE_TABLES) {
    try {
      const row = db.get(`SELECT COUNT(*) AS cnt FROM ${tbl}`);
      out.push({ table: tbl, rows: Number(row?.cnt || 0) });
    } catch {
      out.push({ table: tbl, rows: 0 });
    }
  }
  return out;
}

function computeFileShortHash(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16384);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return crypto
      .createHash('sha256')
      .update(buf.subarray(0, bytesRead))
      .digest('hex')
      .slice(0, 12);
  } catch {
    return '000000000000';
  }
}

function buildOverviewPayload() {
  const cmdInfo = runtimeBridge.getCommandsInfo();
  const diag = getSystemDiagnostics(cmdInfo.commandsCount || 0);
  const wa = runtimeBridge.getWaState();
  const sample = getLatestSample();
  const host = getStaticHostInfo();
  const op = getBotOperationalState();

  return {
    instance: {
      id: 'cipismp-wa-bot',
      name: config.botName,
      prefix: config.prefix,
      timezone: config.timezone,
      bind: `${serverBindInfo.host}:${serverBindInfo.port}`,
      sqliteDriver: getDriverName(),
      cardEngine: diag.cardEngine,
      wa,
      operational: op,
      commands: cmdInfo,
    },
    host,
    telemetry: sample,
    counts: {
      users: diag.usersCount,
      groups: diag.groupsCount,
      linkedMc: diag.linkedMcCount,
      activeVip: diag.activeVipCount,
      banned: diag.bannedCount,
      openTickets: diag.openTicketsCount,
      activeGiveaways: listActiveGiveaways().length,
      scheduledEvents: listScheduledEvents().length,
    },
    integrations: {
      ownerConfigured: config.ownerNumbers.length > 0,
      ownerCount: config.ownerNumbers.length,
      mcHostConfigured: Boolean(process.env.MC_HOST),
      minecraftHost: `${config.minecraft.host}:${config.minecraft.port}`,
      bedrockPort: config.minecraft.bedrockPort,
      pteroConfigured: isPteroConfigured(),
      rconConfigured: isRconConfigured(),
      discordWebhookConfigured: isDiscordWebhookConfigured(),
      discordBotConfigured: isDiscordBotConfigured(),
      aiProvider: config.ai.provider,
      aiModel: config.ai.model,
      aiKeyConfigured: Boolean(config.ai.apiKey),
    },
  };
}

/**
 * Eksekutor CLI internal pada tab Console (seperti input baris perintah Pterodactyl)
 */
async function executeInternalConsoleCommand(rawLine, actorLabel) {
  const clean = String(rawLine || '').trim();
  if (!clean) return { ok: false, output: 'Perintah kosong.' };

  pushConsoleEntry('cmd', 'CP-CLI', `$ ${clean}`);

  const parts = clean.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/^\./, '');
  const arg1 = (parts[1] || '').toLowerCase();
  const rest = parts.slice(2).join(' ').trim();

  if (cmd === 'help' || cmd === '?') {
    const helpText =
      'CLI: status | mem | reload | cmd <cari> | addcoin <628..> <jml> | addvip <628..> <30d> | delvip <628..> | ban <628..> [alasan] | unban <628..> | mode <public|self> | maintenance <on|off> [pesan] | dryrun <on|off> | buttons <on|off> | backup | checkpoint | pairing <628...>';
    logger.info('CP-CLI', helpText);
    return { ok: true, output: helpText };
  }

  if (cmd === 'cmd' || cmd === 'commands') {
    const catalog =
      typeof runtimeBridge.getCommandsCatalog === 'function'
        ? runtimeBridge.getCommandsCatalog()
        : [];
    const q = arg1.toLowerCase();
    const matched = q
      ? catalog.filter(
          (c) =>
            c.name.includes(q) ||
            c.category.includes(q) ||
            (c.aliases || []).some((a) => a.includes(q))
        )
      : catalog;
    const sampleNames = matched.slice(0, 18).map((c) => `.${c.name}`).join(', ');
    const msg = `Ditemukan ${matched.length}/${catalog.length} command${q ? ` (filter: "${q}")` : ''}: ${sampleNames}${matched.length > 18 ? ' ...' : ''}`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'addcoin') {
    const targetJid = normalizeUserJid(parts[1] || '');
    const amt = Math.floor(Number(parts[2] || 0));
    if (!targetJid || !Number.isFinite(amt) || amt === 0) {
      return { ok: false, output: 'Gunakan: addcoin 628xxxxxxxxxx <nominal>' };
    }
    ensureUser(targetJid);
    const newBal = amt > 0 ? addBalance(targetJid, amt) : deductBalance(targetJid, Math.abs(amt)).balance;
    addAuditLog({
      category: 'owner_admin',
      actorJid: actorLabel,
      target: targetJid,
      action: 'panel_cli_coins',
      details: { amt, newBal },
    });
    const msg = `Saldo ${targetJid} diperbarui -> ${newBal} Sakura Coin.`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'addvip') {
    const targetJid = normalizeUserJid(parts[1] || '');
    const dur = parts[2] || '30d';
    if (!targetJid) return { ok: false, output: 'Gunakan: addvip 628xxxxxxxxxx 30d' };
    const res = grantPremium({ actorJid: actorLabel, targetRawJid: targetJid, durationInput: dur, note: 'CLI' });
    if (!res.ok) return { ok: false, output: 'Durasi tidak valid (contoh: 7d, 30d, permanen).' };
    const msg = `Sakura VIP aktif untuk ${targetJid} (${res.durationLabel}).`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'delvip') {
    const targetJid = normalizeUserJid(parts[1] || '');
    if (!targetJid) return { ok: false, output: 'Gunakan: delvip 628xxxxxxxxxx' };
    revokePremium({ actorJid: actorLabel, targetRawJid: targetJid });
    const msg = `Sakura VIP dicabut untuk ${targetJid}.`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'ban') {
    const targetJid = normalizeUserJid(parts[1] || '');
    if (!targetJid) return { ok: false, output: 'Gunakan: ban 628xxxxxxxxxx [alasan]' };
    const res = banUser({ actorJid: actorLabel, targetRawJid: targetJid, reason: rest || 'Banned via CLI' });
    if (!res.ok) return { ok: false, output: `Gagal ban (${res.reason}).` };
    const msg = `User ${targetJid} diblokir.`;
    logger.warn('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'unban') {
    const targetJid = normalizeUserJid(parts[1] || '');
    if (!targetJid) return { ok: false, output: 'Gunakan: unban 628xxxxxxxxxx' };
    unbanUser({ actorJid: actorLabel, targetRawJid: targetJid });
    const msg = `Blokir ${targetJid} dibuka.`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'status') {
    const s = getLatestSample();
    const wa = runtimeBridge.getWaState();
    const op = getBotOperationalState();
    const msg = `WA=${wa.status} | Mode=${op.botMode} | Maint=${op.maintenance ? 'ON' : 'OFF'} | CPU=${s.cpu.processPct}% | RSS=${s.memory.rssMb}MB | Loop=${s.runtime.eventLoopMs}ms`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'mem') {
    const s = getLatestSample();
    const msg = `RSS=${s.memory.rssMb}MB | Heap=${s.memory.heapUsedMb}/${s.memory.heapTotalMb}MB | Ext=${s.memory.externalMb}MB | Host=${s.memory.osUsedMb}/${s.memory.osTotalMb}MB (${s.memory.osMemPct}%)`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'reload') {
    const info =
      typeof runtimeBridge.reloadCommands === 'function'
        ? runtimeBridge.reloadCommands()
        : runtimeBridge.getCommandsInfo();
    addAuditLog({
      category: 'owner_admin',
      actorJid: actorLabel,
      target: 'commands',
      action: 'panel_cli_reload',
      details: info,
    });
    const msg = `Hot-reload selesai: ${info.commandsCount} command (${info.aliasesCount} alias) aktif.`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'mode') {
    if (arg1 !== 'public' && arg1 !== 'self') {
      logger.warn('CP-CLI', 'Gunakan: mode public | mode self');
      return { ok: false, output: 'Gunakan: mode public | mode self' };
    }
    setBotAccessMode({ actorJid: actorLabel, mode: arg1 });
    const msg = `Mode akses bot diubah menjadi: ${arg1.toUpperCase()}`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'maintenance' || cmd === 'mt') {
    if (arg1 !== 'on' && arg1 !== 'off') {
      logger.warn('CP-CLI', 'Gunakan: maintenance on [pesan] | maintenance off');
      return { ok: false, output: 'Gunakan: maintenance on [pesan] | maintenance off' };
    }
    const enabled = arg1 === 'on';
    setMaintenanceState({ actorJid: actorLabel, enabled, reason: rest });
    const msg = `Maintenance ${enabled ? 'DIAKTIFKAN' : 'DIMATIKAN'}${rest ? ` (${rest})` : ''}`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'dryrun') {
    if (arg1 !== 'on' && arg1 !== 'off') {
      return { ok: false, output: 'Gunakan: dryrun on | dryrun off' };
    }
    config.dryRun = arg1 === 'on';
    const msg = `Dry-Run diubah menjadi: ${config.dryRun ? 'ON' : 'OFF'}`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'buttons') {
    if (arg1 !== 'on' && arg1 !== 'off') {
      return { ok: false, output: 'Gunakan: buttons on | buttons off' };
    }
    config.useButtons = arg1 === 'on';
    const msg = `Interactive Buttons diubah menjadi: ${config.useButtons ? 'ON' : 'OFF'}`;
    logger.info('CP-CLI', msg);
    return { ok: true, output: msg };
  }

  if (cmd === 'backup') {
    const bkp = await createBackup('cli-panel');
    measureStorage(true);
    addAuditLog({
      category: 'backup',
      actorJid: actorLabel,
      target: bkp.fileName,
      action: 'panel_cli_backup',
    });
    return { ok: true, output: `Backup dibuat: ${bkp.fileName}` };
  }

  if (cmd === 'checkpoint') {
    try {
      getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // sql.js in-memory mode aman mengabaikan wal_checkpoint
    }
    measureStorage(true);
    logger.info('CP-CLI', 'SQLite WAL checkpoint selesai dijalankan.');
    return { ok: true, output: 'SQLite WAL checkpoint selesai.' };
  }

  if (cmd === 'pairing') {
    const phone = (parts[1] || '').replace(/[^0-9]/g, '');
    if (phone.length < 8) {
      return { ok: false, output: 'Gunakan: pairing 628xxxxxxxxxx' };
    }
    if (typeof runtimeBridge.requestPairing !== 'function') {
      logger.warn('CP-CLI', 'Mode standalone: socket Baileys belum dijalankan pada proses ini.');
      return { ok: false, output: 'Socket WhatsApp tidak aktif di mode standalone.' };
    }
    const pr = await runtimeBridge.requestPairing(phone);
    if (!pr.ok) {
      logger.warn('CP-CLI', pr.error || 'Gagal meminta kode pairing.');
      return { ok: false, output: pr.error || 'Gagal meminta kode pairing.' };
    }
    logger.info('CP-CLI', `Kode Pairing untuk +${phone}: ${pr.pairingCode}`);
    return { ok: true, output: `Kode Pairing: ${pr.pairingCode}`, pairingCode: pr.pairingCode };
  }

  logger.warn('CP-CLI', `Perintah tidak dikenal: "${cmd}". Ketik "help" untuk daftar perintah.`);
  return { ok: false, output: `Perintah "${cmd}" tidak dikenal. Ketik "help".` };
}

/**
 * Handler SSE Real-Time (Console Logs + Telemetry)
 */
function handleSseStream(req, res) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const writeEvent = (eventName, data) => {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Koneksi sudah tertutup
    }
  };

  writeEvent('init', {
    consoleBuffer: getConsoleBuffer(180),
    telemetryHistory: getTelemetryHistory(),
    overview: buildOverviewPayload(),
  });

  const unsubLogs = subscribeConsoleLogs((entry) => {
    writeEvent('console', entry);
  });

  const unsubTelemetry = subscribeTelemetry((sample) => {
    writeEvent('telemetry', sample);
  });

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // Abaikan
    }
  }, 15000);
  if (typeof keepAlive.unref === 'function') keepAlive.unref();

  const clientRef = {
    close() {
      clearInterval(keepAlive);
      unsubLogs();
      unsubTelemetry();
      try {
        res.end();
      } catch {
        // Abaikan
      }
    },
  };
  sseClients.add(clientRef);

  req.on('close', () => {
    sseClients.delete(clientRef);
    clientRef.close();
  });
}

async function handleApiRequest(req, res, pathname, searchParams) {
  const clientIp = String(
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
  )
    .split(',')[0]
    .trim();
  const isSandboxPreview = process.env.PANEL_SANDBOX_PREVIEW === 'true';

  // 1. Endpoint Publik (Status Auth & Login)
  if (pathname === '/api/auth/status' && req.method === 'GET') {
    const sess = extractSession(req);
    return sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(sess),
      username: sess?.username || null,
      botName: config.botName,
      sandboxPreview: isSandboxPreview,
      usingGeneratedPin: !config.panel.password,
    });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (isLoginRateLimited(clientIp)) {
      return sendJson(res, 429, {
        ok: false,
        error: 'Terlalu banyak percobaan login gagal. Coba lagi dalam 60 detik.',
      });
    }

    const body = await readJsonBody(req);
    const allowQuickPreview = isSandboxPreview && body.quickPreview === true;
    const inputUser = String(body.username || '').trim();
    const inputPass = String(body.password || '');

    const validUser = safeTimingEqual(inputUser, config.panel.username || 'admin');
    const validPass = safeTimingEqual(inputPass, getEffectivePanelPassword());

    if (!allowQuickPreview && (!validUser || !validPass)) {
      recordFailedLogin(clientIp);
      addAuditLog({
        level: 'warn',
        category: 'panel_auth',
        actorJid: clientIp,
        target: inputUser || 'unknown',
        action: 'panel_login_failed',
      });
      return sendJson(res, 401, {
        ok: false,
        error: 'Kredensial tidak valid.',
      });
    }

    clearFailedLogins(clientIp);
    const username = config.panel.username || 'admin';
    const token = createSessionToken(username);
    const maxAge = Math.floor((config.panel.sessionTtlMs || 43200000) / 1000);

    addAuditLog({
      level: 'info',
      category: 'panel_auth',
      actorJid: `panel:${username}`,
      target: clientIp,
      action: 'panel_login_success',
      details: { quickPreview: allowQuickPreview },
    });

    return sendJson(
      res,
      200,
      { ok: true, username, token },
      {
        'Set-Cookie': `cp_session=${encodeURIComponent(
          token
        )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
      }
    );
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return sendJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': 'cp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' }
    );
  }

  // 2. Seluruh Endpoint di Bawah Ini WAJIB Memiliki Sesi Valid
  const allowQueryToken =
    pathname === '/api/stream' || pathname === '/api/backups/download';
  const session = extractSession(req, allowQueryToken ? searchParams : null);
  if (!session) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Sesi tidak terautentikasi atau telah berakhir.',
    });
  }
  const actorLabel = `panel:${session.username}`;

  // SSE Real-Time Stream
  if (pathname === '/api/stream' && req.method === 'GET') {
    return handleSseStream(req, res);
  }

  // Overview & Telemetry History
  if (pathname === '/api/overview' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      overview: buildOverviewPayload(),
      telemetryHistory: getTelemetryHistory(),
    });
  }

  // Power Actions (Instance Header Controls)
  if (pathname === '/api/power' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = String(body.action || '').toLowerCase();

    if (action === 'reload') {
      const info =
        typeof runtimeBridge.reloadCommands === 'function'
          ? runtimeBridge.reloadCommands()
          : runtimeBridge.getCommandsInfo();
      addAuditLog({
        category: 'owner_admin',
        actorJid: actorLabel,
        target: 'commands',
        action: 'panel_hot_reload',
        details: info,
      });
      logger.info('PANEL', `Hot-reload dijalankan oleh ${session.username} (${info.commandsCount} command)`);
      return sendJson(res, 200, { ok: true, message: `Reloaded ${info.commandsCount} commands`, ...info });
    }

    if (action === 'restart') {
      const rst = await triggerGracefulBotRestart({ actorJid: actorLabel });
      return sendJson(res, 200, { ok: true, ...rst });
    }

    if (action === 'connect') {
      if (typeof runtimeBridge.connectWa === 'function') {
        await runtimeBridge.connectWa();
        logger.info('PANEL', 'Sinyal reconnect WhatsApp dikirim dari Cipi Panel.');
        return sendJson(res, 200, { ok: true, message: 'Sinyal koneksi WhatsApp dikirim.' });
      }
      return sendJson(res, 200, {
        ok: true,
        message: 'Mode standalone aktif (proses WhatsApp dikelola via npm start / PM2).',
      });
    }

    if (action === 'disconnect') {
      if (typeof runtimeBridge.disconnectWa === 'function') {
        await runtimeBridge.disconnectWa();
        logger.warn('PANEL', 'Socket WhatsApp diputus sementara melalui Cipi Panel.');
        return sendJson(res, 200, { ok: true, message: 'Socket WhatsApp diputus sementara.' });
      }
      return sendJson(res, 200, {
        ok: true,
        message: 'Tidak ada socket WhatsApp aktif pada mode standalone.',
      });
    }

    return sendJson(res, 400, { ok: false, error: 'Aksi power tidak dikenal.' });
  }

  // Console Internal Command Execution
  if (pathname === '/api/console/exec' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await executeInternalConsoleCommand(body.command, actorLabel);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  // Runtime Config & Pairing
  if (pathname === '/api/runtime/config' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (body.botMode === 'public' || body.botMode === 'self') {
      setBotAccessMode({ actorJid: actorLabel, mode: body.botMode });
      logger.info('PANEL', `Mode bot diubah ke ${body.botMode.toUpperCase()} oleh ${session.username}`);
    }
    if (typeof body.maintenance === 'boolean') {
      setMaintenanceState({
        actorJid: actorLabel,
        enabled: body.maintenance,
        reason: body.maintenanceReason || '',
      });
      logger.info(
        'PANEL',
        `Maintenance diubah ke ${body.maintenance ? 'ON' : 'OFF'} oleh ${session.username}`
      );
    }
    if (typeof body.dryRun === 'boolean') {
      config.dryRun = body.dryRun;
      addAuditLog({
        category: 'owner_admin',
        actorJid: actorLabel,
        target: 'dry_run',
        action: body.dryRun ? 'dryrun_on' : 'dryrun_off',
      });
      logger.info('PANEL', `Dry-Run diubah ke ${body.dryRun ? 'ON' : 'OFF'} oleh ${session.username}`);
    }
    if (typeof body.useButtons === 'boolean') {
      config.useButtons = body.useButtons;
      logger.info(
        'PANEL',
        `Interactive Buttons diubah ke ${body.useButtons ? 'ON' : 'OFF'} oleh ${session.username}`
      );
    }
    return sendJson(res, 200, { ok: true, overview: buildOverviewPayload() });
  }

  if (pathname === '/api/runtime/pairing' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const phone = String(body.phone || '').replace(/[^0-9]/g, '');
    if (phone.length < 8 || phone.length > 16) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Masukkan nomor telepon internasional yang valid (contoh: 6281234567890).',
      });
    }
    if (typeof runtimeBridge.requestPairing !== 'function') {
      return sendJson(res, 400, {
        ok: false,
        error: 'Panel berjalan dalam mode standalone. Jalankan via `npm start` atau PM2 di VPS untuk meminta Pairing Code langsung.',
      });
    }
    const pairRes = await runtimeBridge.requestPairing(phone);
    return sendJson(res, pairRes.ok ? 200 : 400, pairRes);
  }

  // Command Registry (79 Commands + Aliases)
  if (pathname === '/api/commands' && req.method === 'GET') {
    const catalog =
      typeof runtimeBridge.getCommandsCatalog === 'function'
        ? runtimeBridge.getCommandsCatalog()
        : [];
    return sendJson(res, 200, {
      ok: true,
      prefix: config.prefix,
      count: catalog.length,
      commands: catalog,
    });
  }

  // Minecraft & Pterodactyl Wings Integration
  if (pathname === '/api/minecraft' && req.method === 'GET') {
    const mcStatus = await fetchMinecraftServerStatus(
      config.minecraft.host,
      config.minecraft.port
    ).catch((err) => ({ ok: false, online: false, error: err.message }));

    let pteroResources = null;
    if (isPteroConfigured() && !config.dryRun) {
      pteroResources = await getServerResources().catch(() => null);
    }

    const linkedPlayers = getDb().all(
      `SELECT l.jid, l.mc_username, l.is_bedrock, l.linked_at, u.name, u.phone, u.playtime_minutes
       FROM links l
       LEFT JOIN users u ON u.jid = l.jid
       WHERE l.status = 'linked'
       ORDER BY u.playtime_minutes DESC
       LIMIT 100`
    );

    return sendJson(res, 200, {
      ok: true,
      host: config.minecraft.host,
      port: config.minecraft.port,
      bedrockPort: config.minecraft.bedrockPort,
      pteroConfigured: isPteroConfigured(),
      rconConfigured: isRconConfigured(),
      whitelistCommands: config.minecraft.consoleWhitelist,
      whitelistPrefixes: config.minecraft.consoleParameterizedPrefixes,
      status: {
        online: Boolean(mcStatus?.online),
        playersOnline: Number(mcStatus?.playersOnline || 0),
        playersMax: Number(mcStatus?.playersMax || 0),
        version: mcStatus?.version || '-',
        motd: mcStatus?.motd || '',
        samplePlayers: mcStatus?.samplePlayers || [],
        sourceApi: mcStatus?.sourceApi || 'offline',
      },
      pteroResources,
      linkedPlayers: linkedPlayers.map((p) => ({
        jid: p.jid,
        waName: p.name || p.phone || extractPhoneFromJid(p.jid),
        phone: p.phone || extractPhoneFromJid(p.jid),
        mcUsername: p.mc_username,
        isBedrock: Boolean(p.is_bedrock),
        playtimeMinutes: Number(p.playtime_minutes || 0),
        linkedWib: formatTimestampWib(p.linked_at),
      })),
    });
  }

  if (pathname === '/api/minecraft/power' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = String(body.action || '').toLowerCase();

    if (action === 'backup') {
      const bkp = await createPteroServerBackup(body.name || 'cp-backup');
      addAuditLog({
        category: 'server_control',
        actorJid: actorLabel,
        target: 'pterodactyl',
        action: 'panel_mc_backup',
        details: bkp,
      });
      return sendJson(res, bkp.ok ? 200 : 400, bkp);
    }

    if (!['start', 'restart', 'stop'].includes(action)) {
      return sendJson(res, 400, { ok: false, error: 'Sinyal power tidak valid.' });
    }

    const sigRes = await sendPowerSignal(action);
    addAuditLog({
      level: action === 'stop' ? 'warn' : 'info',
      category: 'server_control',
      actorJid: actorLabel,
      target: 'pterodactyl',
      action: `panel_power_${action}`,
      details: sigRes,
    });
    return sendJson(res, sigRes.ok ? 200 : 400, sigRes);
  }

  if (pathname === '/api/minecraft/console' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const cmdText = String(body.command || '').trim();
    const check = validateWhitelistedConsoleCommand(cmdText);
    if (!check.allowed) {
      return sendJson(res, 403, {
        ok: false,
        error: `Ditolak whitelist keamanan: ${check.reason}`,
      });
    }

    const cleanCmd = check.cleanCommand || check.sanitized || cmdText;
    const execRes = await executeMinecraftCommand(cleanCmd, {
      preferRconForOutput: true,
    });
    addAuditLog({
      category: 'server_control',
      actorJid: actorLabel,
      target: 'mc_console',
      action: 'panel_console_cmd',
      details: { command: cleanCmd, ok: execRes.ok },
    });
    return sendJson(res, execRes.ok ? 200 : 400, execRes);
  }

  // Users, Economy & Sakura VIP
  if (pathname === '/api/users/ensure' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const digits = String(body.phone || '').replace(/[^0-9]/g, '');
    if (digits.length < 7 || digits.length > 16) {
      return sendJson(res, 400, { ok: false, error: 'Masukkan nomor WhatsApp valid (contoh: 6281234567890).' });
    }
    const normalizedPhone = digits.startsWith('08') ? `62${digits.slice(1)}` : digits;
    const jid = normalizeUserJid(`${normalizedPhone}@s.whatsapp.net`);
    const cleanName = String(body.name || '').trim().slice(0, 48);
    ensureUser(jid, cleanName || undefined);
    if (cleanName) {
      getDb().run('UPDATE users SET name = ? WHERE jid = ?', [cleanName, jid]);
    }
    addAuditLog({
      category: 'owner_admin',
      actorJid: actorLabel,
      target: jid,
      action: 'panel_ensure_user',
    });
    logger.info('PANEL', `Akun user diregistrasi/diinspeksi di SQLite: ${jid}`);
    return sendJson(res, 200, { ok: true, jid, phone: normalizedPhone });
  }

  if (pathname === '/api/users' && req.method === 'GET') {
    const q = String(searchParams.get('q') || '').trim().toLowerCase();
    const filter = String(searchParams.get('filter') || 'all').toLowerCase();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.max(5, Math.min(100, Number(searchParams.get('pageSize') || 25)));
    const now = Date.now();

    const rows = getDb().all(
      `SELECT u.jid, u.phone, u.name, u.title, u.level, u.xp, u.is_banned, u.ban_reason, u.playtime_minutes, u.last_seen,
              COALESCE(e.balance, 0) AS balance, COALESCE(e.bank, 0) AS bank, COALESCE(e.gacha_shards, 0) AS shards,
              p.active AS vip_active, p.expires_at AS vip_expires_at, p.note AS vip_note,
              l.mc_username, l.is_bedrock
       FROM users u
       LEFT JOIN economy e ON e.jid = u.jid
       LEFT JOIN premium p ON p.jid = u.jid
       LEFT JOIN links l ON l.jid = u.jid AND l.status = 'linked'
       ORDER BY u.last_seen DESC
       LIMIT 500`
    );

    const filtered = rows
      .map((r) => {
        const isVip = Boolean(r.vip_active && Number(r.vip_expires_at) > now);
        return {
          jid: r.jid,
          phone: r.phone || extractPhoneFromJid(r.jid),
          name: r.name || 'Member',
          title: r.title || '-',
          level: Number(r.level || 1),
          xp: Number(r.xp || 0),
          balance: Number(r.balance || 0),
          bank: Number(r.bank || 0),
          shards: Number(r.shards || 0),
          playtimeMinutes: Number(r.playtime_minutes || 0),
          isBanned: Boolean(r.is_banned),
          banReason: r.ban_reason || '',
          isVip,
          vipExpiresWib: isVip ? formatTimestampWib(r.vip_expires_at) : null,
          vipNote: r.vip_note || '',
          mcUsername: r.mc_username || null,
          isBedrock: Boolean(r.is_bedrock),
          lastSeenWib: formatTimestampWib(r.last_seen),
        };
      })
      .filter((u) => {
        if (filter === 'vip' && !u.isVip) return false;
        if (filter === 'banned' && !u.isBanned) return false;
        if (filter === 'linked' && !u.mcUsername) return false;
        if (!q) return true;
        return (
          u.name.toLowerCase().includes(q) ||
          u.phone.toLowerCase().includes(q) ||
          (u.mcUsername && u.mcUsername.toLowerCase().includes(q))
        );
      });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const items = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

    return sendJson(res, 200, {
      ok: true,
      total,
      page: safePage,
      pageSize,
      totalPages,
      users: items,
    });
  }

  if (pathname === '/api/users/coins' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = normalizeUserJid(body.jid || '');
    const delta = Math.floor(Number(body.delta || 0));
    if (!jid || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 10_000_000) {
      return sendJson(res, 400, { ok: false, error: 'Target JID atau nominal koin tidak valid.' });
    }
    ensureUser(jid);
    let newBalance = 0;
    if (delta > 0) {
      newBalance = Number(addBalance(jid, delta) || 0);
    } else {
      const walletRes = deductBalance(jid, Math.abs(delta));
      if (!walletRes.ok) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Saldo user tidak mencukupi untuk pengurangan tersebut.',
        });
      }
      newBalance = Number(walletRes.balance || 0);
    }
    addAuditLog({
      category: 'owner_admin',
      actorJid: actorLabel,
      target: jid,
      action: delta > 0 ? 'panel_add_coins' : 'panel_deduct_coins',
      details: { delta, newBalance },
    });
    logger.info('PANEL', `Saldo ${jid} diubah sebesar ${delta > 0 ? '+' : ''}${delta} (baru: ${newBalance})`);
    return sendJson(res, 200, { ok: true, newBalance });
  }

  if (pathname === '/api/users/vip' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = normalizeUserJid(body.jid || '');
    if (!jid) return sendJson(res, 400, { ok: false, error: 'Nomor/JID tidak valid.' });

    if (body.action === 'revoke') {
      const rev = revokePremium({ actorJid: actorLabel, targetRawJid: jid });
      logger.info('PANEL', `Status VIP dicabut untuk ${jid}`);
      return sendJson(res, 200, rev);
    }

    const granted = grantPremium({
      actorJid: actorLabel,
      targetRawJid: jid,
      durationInput: body.duration || '30d',
      note: body.note || 'Granted via Cipi Panel',
    });
    if (!granted.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Durasi tidak valid (gunakan 7d, 30d, 1bulan, 1tahun, atau permanen).',
      });
    }
    logger.info('PANEL', `Sakura VIP diberikan ke ${jid} (${body.duration || '30d'})`);
    return sendJson(res, 200, granted);
  }

  if (pathname === '/api/users/ban' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const jid = normalizeUserJid(body.jid || '');
    if (!jid) return sendJson(res, 400, { ok: false, error: 'Nomor/JID tidak valid.' });

    if (body.action === 'unban') {
      const unb = unbanUser({ actorJid: actorLabel, targetRawJid: jid });
      logger.info('PANEL', `Unban user ${jid}`);
      return sendJson(res, 200, unb);
    }

    const banned = banUser({
      actorJid: actorLabel,
      targetRawJid: jid,
      reason: body.reason || 'Restricted via Cipi Panel',
    });
    if (!banned.ok) {
      return sendJson(res, 400, {
        ok: false,
        error:
          banned.reason === 'cannot_ban_owner'
            ? 'Nomor Owner dilindungi dan tidak dapat diblokir.'
            : 'Gagal memblokir user.',
      });
    }
    logger.warn('PANEL', `User ${jid} diblokir (${body.reason || 'Restricted via Cipi Panel'})`);
    return sendJson(res, 200, banned);
  }

  // Broadcast, Tickets & Community
  if (pathname === '/api/community' && req.method === 'GET') {
    const tickets = getDb().all(
      "SELECT * FROM tickets ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, id DESC LIMIT 50"
    );
    const groups = getDb().all('SELECT * FROM groups ORDER BY updated_at DESC LIMIT 50');
    const giveaways = listActiveGiveaways();
    const events = listScheduledEvents();

    return sendJson(res, 200, {
      ok: true,
      tickets: tickets.map((t) => ({
        ticketNo: t.ticket_no,
        userName: t.user_name || extractPhoneFromJid(t.jid),
        jid: t.jid,
        category: t.category,
        subject: t.subject,
        message: t.message,
        status: t.status,
        resolution: t.resolution || '',
        createdWib: formatTimestampWib(t.created_at),
      })),
      giveaways: giveaways.map((g) => ({
        code: g.code,
        title: g.title,
        prize: g.prize,
        winnerCount: g.winner_count,
        participantsCount: JSON.parse(g.participants_json || '[]').length,
        endsWib: formatTimestampWib(g.ends_at),
      })),
      events: events.map((ev) => ({
        code: ev.code,
        title: ev.title,
        description: ev.description,
        schedule: ev.is_recurring ? `Cron: ${ev.cron_expr}` : formatTimestampWib(ev.run_at),
      })),
      groups: groups.map((gr) => ({
        jid: gr.jid,
        name: gr.name || gr.jid,
        welcome: Boolean(gr.welcome_enabled),
        antilink: Boolean(gr.antilink),
        antispam: Boolean(gr.antispam),
        muted: Boolean(gr.mute),
        bridge: Boolean(gr.bridge_enabled),
      })),
    });
  }

  if (pathname === '/api/broadcast' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const targetMode = ['wa', 'mc', 'dc', 'all'].includes(body.targetMode)
      ? body.targetMode
      : 'all';
    const sanitized = sanitizeBroadcastInput(body.message || '');
    if (!sanitized.valid) {
      return sendJson(res, 400, {
        ok: false,
        error:
          sanitized.reason === 'too_long'
            ? `Pesan melampaui batas (${sanitized.length}/${sanitized.maxLen} karakter).`
            : 'Isi pesan pengumuman kosong atau tidak valid.',
      });
    }

    const bcRes = await executeConfirmedBroadcast({
      sock: runtimeBridge.getSock(),
      senderJid: config.ownerNumbers[0]
        ? `${config.ownerNumbers[0]}@s.whatsapp.net`
        : actorLabel,
      senderName: `${config.ownerName} (Panel)`,
      targetMode,
      sanitized,
    });
    logger.info('PANEL', `Broadcast dikirim ke target=${targetMode} oleh ${session.username}`);
    return sendJson(res, 200, { ok: true, result: bcRes });
  }

  if (pathname === '/api/tickets/close' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const closed = await closeSupportTicket({
      actorRawJid: config.ownerNumbers[0] || actorLabel,
      actorName: session.username,
      isStaff: true,
      ticketNoInput: body.ticketNo,
      resolutionText: body.resolution || 'Closed via Cipi Panel',
    });
    if (!closed.ok) {
      return sendJson(res, 400, { ok: false, error: `Gagal menutup tiket (${closed.reason}).` });
    }
    logger.info('PANEL', `Tiket ${body.ticketNo} ditutup oleh ${session.username}`);
    return sendJson(res, 200, closed);
  }

  // Backups & SQLite Storage
  if (pathname === '/api/backups' && req.method === 'GET') {
    const storage = measureStorage(true);
    const files = listBackups().map((f) => ({
      name: f.fileName,
      bytes: f.sizeBytes,
      sizeKb: Number((f.sizeBytes / 1024).toFixed(1)),
      sha256Short: computeFileShortHash(f.filePath),
      mtimeMs: f.mtimeMs,
      createdWib: formatTimestampWib(f.mtimeMs),
    }));
    return sendJson(res, 200, {
      ok: true,
      keepLast: config.backup.keepLast,
      cronSchedule: config.backup.cronSchedule,
      storage,
      tables: getSqliteTableStats(),
      backups: files,
    });
  }

  if (pathname === '/api/backups/create' && req.method === 'POST') {
    const bkp = await createBackup('panel');
    measureStorage(true);
    addAuditLog({
      category: 'backup',
      actorJid: actorLabel,
      target: bkp.fileName,
      action: 'panel_manual_backup',
    });
    return sendJson(res, 200, { ok: true, backup: bkp });
  }

  if (pathname === '/api/backups/download' && req.method === 'GET') {
    const safeName = path.basename(String(searchParams.get('file') || ''));
    if (!safeName.endsWith('.db')) {
      return sendJson(res, 400, { ok: false, error: 'Nama file backup tidak valid.' });
    }
    const activeBackupsDir = process.env.BACKUP_DIR
      ? path.resolve(process.env.BACKUP_DIR)
      : config.paths.backupsDir;
    const fullPath = path.join(activeBackupsDir, safeName);
    if (!fs.existsSync(fullPath)) {
      return sendJson(res, 404, { ok: false, error: 'File backup tidak ditemukan.' });
    }
    const stat = fs.statSync(fullPath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': stat.size,
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  if (pathname === '/api/storage/checkpoint' && req.method === 'POST') {
    try {
      getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // Aman diabaikan pada driver sql.js
    }
    const storage = measureStorage(true);
    addAuditLog({
      category: 'backup',
      actorJid: actorLabel,
      target: 'sqlite_wal',
      action: 'panel_wal_checkpoint',
    });
    logger.info('PANEL', 'SQLite WAL checkpoint berhasil dijalankan.');
    return sendJson(res, 200, { ok: true, storage });
  }

  // Audit Logs
  if (pathname === '/api/audit' && req.method === 'GET') {
    const limit = Math.max(5, Math.min(100, Number(searchParams.get('limit') || 50)));
    const category = String(searchParams.get('category') || '');
    const logs = getRecentAuditLogs(limit, category);
    return sendJson(res, 200, { ok: true, logs });
  }

  return sendJson(res, 404, { ok: false, error: 'Endpoint tidak ditemukan.' });
}

function startControlPanelServer(opts = {}) {
  if (panelServer) return Promise.resolve(panelServer);

  startTelemetry();
  const host = opts.host || config.panel.host || '0.0.0.0';
  const port = opts.port !== undefined ? Number(opts.port) : Number(config.panel.port || 3000);

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const parsed = new URL(req.url || '/', 'http://localhost');
        const pathname = parsed.pathname;

        if (pathname.startsWith('/api/')) {
          await handleApiRequest(req, res, pathname, parsed.searchParams);
          return;
        }

        const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const resolved = path.resolve(PUBLIC_DIR, rel);
        if (!resolved.startsWith(PUBLIC_DIR)) {
          res.writeHead(403, SECURITY_HEADERS);
          res.end('Forbidden');
          return;
        }

        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return serveStaticFile(res, resolved);
        }

        return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
      } catch (err) {
        logger.error('PANEL', 'Unhandled error pada HTTP server panel', err);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: err.message || 'Internal Server Error' });
        }
      }
    });

    srv.once('error', (err) => {
      logger.error('PANEL', `Gagal mengikat port ${port}`, err);
      reject(err);
    });

    srv.listen(port, host, () => {
      panelServer = srv;
      const addr = srv.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      serverBindInfo = { host, port: actualPort };
      logger.info(
        'PANEL',
        `Cipi Panel aktif pada http://${host}:${actualPort} (user: ${config.panel.username})`
      );
      if (!config.panel.password) {
        logger.warn(
          'PANEL',
          `PANEL_PASSWORD kosong di .env — PIN sesi sementara: ${generatedStartupPin}`
        );
      }
      resolve(srv);
    });
  });
}

function stopControlPanelServer() {
  return new Promise((resolve) => {
    stopTelemetry();
    for (const client of sseClients) {
      client.close();
    }
    sseClients.clear();

    if (!panelServer) return resolve();
    const srv = panelServer;
    panelServer = null;
    srv.close(() => resolve());
  });
}

module.exports = {
  attachBotRuntimeToPanel,
  startControlPanelServer,
  stopControlPanelServer,
  getEffectivePanelPassword,
  createSessionToken,
  verifySessionToken,
};
