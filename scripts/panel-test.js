/**
 * ═══════════════════════════════════════════════════════════
 *  Cipi Panel (CP) — Automated Integration & Security Suite
 * ═══════════════════════════════════════════════════════════
 *  Menguji UI Dark/Light, Logo CP, Zero-Emoji Policy, Font Lokal,
 *  Auth HMAC-SHA256, Brute-Force Limiter, SSE Live Stream,
 *  Redaksi Secret, Internal CLI, RCON Whitelist, & 7 Modul API.
 * ═══════════════════════════════════════════════════════════
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cipi-panel-test-'));
process.env.PANEL_ENABLED = 'true';
process.env.PANEL_HOST = '127.0.0.1';
process.env.PANEL_PORT = '0'; // Ephemeral port
process.env.PANEL_USERNAME = 'admin';
process.env.PANEL_PASSWORD = 'CipiPanel_SuperSecret_2026!';
process.env.PANEL_SESSION_SECRET = 'hmac-unit-test-secret-key-998877';
process.env.DRY_RUN = 'true';
process.env.DB_PATH = path.join(tmpRoot, 'test-panel.db');
process.env.BACKUP_DIR = path.join(tmpRoot, 'backups');
process.env.SESSION_DIR = path.join(tmpRoot, 'session');
process.env.LOG_DIR = path.join(tmpRoot, 'logs');

const { logger } = require('../lib/logger');
const { initDatabase, getDb, ensureUser, closeDatabase } = require('../lib/database');
const { collectSample, measureStorage } = require('../lib/telemetry');
const { loadCommands, getCommandsCatalog } = require('../index');
const { attachBotRuntimeToPanel, startControlPanelServer, stopControlPanelServer } = require('../lib/panel');

let baseUrl = '';
let sessionCookie = '';
let passed = 0;

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}\n    -> ${err.stack || err.message}`);
    throw err;
  }
}

async function req(urlPath, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.cookie !== undefined) {
    if (opts.cookie) headers.Cookie = opts.cookie;
  } else if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie') || '';
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  let rawBuffer = null;

  if (contentType.includes('application/json')) {
    data = await res.json();
  } else if (opts.binary) {
    rawBuffer = Buffer.from(await res.arrayBuffer());
  } else {
    data = await res.text();
  }

  return { status: res.status, headers: res.headers, setCookie, data, rawBuffer };
}

function openSseClient(cookie) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${baseUrl}/api/stream`);
    const events = [];
    const clientReq = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'GET',
        headers: { Cookie: cookie },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE status ${res.statusCode}`));
          return;
        }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const frame of parts) {
            const lines = frame.split('\n');
            let evName = 'message';
            let evData = '';
            for (const line of lines) {
              if (line.startsWith('event:')) evName = line.slice(6).trim();
              if (line.startsWith('data:')) evData += line.slice(5).trim();
            }
            if (evData) {
              try {
                events.push({ event: evName, data: JSON.parse(evData) });
              } catch {
                events.push({ event: evName, data: evData });
              }
            }
          }
        });
        resolve({
          events,
          close: () => clientReq.destroy(),
        });
      }
    );
    clientReq.on('error', reject);
    clientReq.end();
  });
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Cipi Panel (CP) — Comprehensive Verification Suite');
  console.log('══════════════════════════════════════════════════════════');

  // 1. Static UI, Fonts, CP Logo, Dark/Light Mode & Zero-Emoji Policy
  await step('Brand identity: logo monogram CP (asli) dipakai sidebar, login, favicon & PWA manifest', () => {
    const pubDir = path.join(__dirname, '..', 'panel', 'public');
    const assetsDir = path.join(pubDir, 'assets');

    const badge = path.join(assetsDir, 'logo-cp-badge.png');
    const badgeMeta = fs.readFileSync(badge);
    assert.ok(badgeMeta.subarray(1, 4).toString() === 'PNG', 'logo-cp-badge.png harus berupa PNG valid');
    assert.ok(fs.statSync(badge).size > 2000, 'logo-cp-badge.png tampak kosong/korup');

    for (const icon of ['favicon-32.png', 'logo-cp-180.png', 'logo-cp-192.png', 'logo-cp-512.png', 'logo-cp-maskable-512.png']) {
      const stat = fs.statSync(path.join(assetsDir, icon));
      assert.ok(stat.size > 800, `Ikon ${icon} tampak kosong/korup`);
    }
    assert.ok(!fs.existsSync(path.join(assetsDir, 'logo-cp.svg')), 'Logo SVG lama harus sudah dihapus (single source PNG)');

    const manifest = JSON.parse(fs.readFileSync(path.join(pubDir, 'manifest.webmanifest'), 'utf8'));
    assert.ok(manifest.name.includes('Cipi Panel'), 'manifest.webmanifest harus memakai brand Cipi Panel');
    assert.ok(manifest.icons.length >= 3, 'manifest.webmanifest harus mendaftarkan ikon any + maskable');
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'manifest.webmanifest butuh ikon maskable');

    const html = fs.readFileSync(path.join(pubDir, 'index.html'), 'utf8');
    const logoRefs = html.split('/assets/logo-cp-badge.png').length - 1;
    assert.strictEqual(logoRefs, 2, 'Logo CP harus dipakai di login + sidebar (2 referensi)');
    assert.ok(html.includes('rel="icon" type="image/png" sizes="32x32"'), 'favicon PNG 32 harus ditautkan di <head>');
    assert.ok(html.includes('rel="apple-touch-icon"'), 'apple-touch-icon harus ditautkan untuk iOS');
    assert.ok(html.includes('rel="manifest"'), 'manifest PWA harus ditautkan di <head>');
    assert.ok(html.includes('class="cp-logo-img"'), 'Sidebar & login harus merender <img class="cp-logo-img">');
    assert.ok(!html.includes('logo-cp.svg'), 'index.html tidak boleh lagi menunjuk logo SVG lama');

    const css = fs.readFileSync(path.join(pubDir, 'styles.css'), 'utf8');
    assert.ok(css.includes('.cp-mark .cp-logo-img'), 'styles.css harus menata .cp-logo-img di dalam .cp-mark');
    assert.ok(css.includes('object-fit: cover'), 'Logo harus mengisi tile badge presisi');
  });

  await step('Static assets: self-hosted Inter & JetBrains Mono .woff2 fonts present', () => {
    const fontDir = path.join(__dirname, '..', 'panel', 'public', 'fonts');
    const expected = [
      'inter-latin-400-normal.woff2',
      'inter-latin-500-normal.woff2',
      'inter-latin-600-normal.woff2',
      'jetbrains-mono-latin-400-normal.woff2',
      'jetbrains-mono-latin-500-normal.woff2',
      'jetbrains-mono-latin-600-normal.woff2',
    ];
    for (const f of expected) {
      const stat = fs.statSync(path.join(fontDir, f));
      assert.ok(stat.size > 5000, `Font ${f} tampak kosong/korup`);
    }
  });

  await step('UI discipline: CP (Cipi Panel) brand, Dark & Light themes, tabular-nums, and 0% emojis', () => {
    const pubDir = path.join(__dirname, '..', 'panel', 'public');
    const html = fs.readFileSync(path.join(pubDir, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(pubDir, 'styles.css'), 'utf8');
    const appJs = fs.readFileSync(path.join(pubDir, 'app.js'), 'utf8');
    const chartsJs = fs.readFileSync(path.join(pubDir, 'charts.js'), 'utf8');

    assert.ok(html.includes('Cipi Panel'), 'index.html harus menampilkan nama Cipi Panel');
    assert.ok(html.includes('CP — Cipi Panel'), 'index.html harus menampilkan brand CP — Cipi Panel');
    assert.ok(html.includes('id="themeToggleBtn"'), 'Tombol switch Dark/Light mode harus tersedia');
    assert.ok(html.includes('id="sidebarBackdrop"'), 'Backdrop off-canvas mobile/tablet harus tersedia');
    assert.ok(html.includes('class="view-tabs-bar"'), 'Tab navigasi cepat tablet/mobile harus tersedia');
    assert.ok(css.includes('[data-theme="dark"]'), 'styles.css harus memiliki palet Dark Mode');
    assert.ok(css.includes('[data-theme="light"]'), 'styles.css harus memiliki palet Light Mode');
    assert.ok(css.includes('tabular-nums'), 'styles.css harus menerapkan font-variant-numeric: tabular-nums');
    assert.ok(css.includes('@media (min-width: 1024px)'), 'styles.css harus mengunci backdrop agar tidak pernah nge-blur di Desktop');
    assert.ok(css.includes('.app-shell.sidebar-collapsed'), 'styles.css harus mendukung collapse sidebar bersih di Desktop');
    assert.ok(css.includes('.btn.sidebar-close-btn'), 'Tombol close sidebar harus tersembunyi di Desktop');
    assert.ok(appJs.includes('toggleSidebarMenu'), 'app.js harus membedakan toggle sidebar Desktop (collapse) vs Mobile (drawer)');
    assert.ok(css.includes('@media (max-width: 1179px)'), 'styles.css harus memiliki breakpoint tablet landscape');
    assert.ok(css.includes('@media (max-width: 1023px)'), 'styles.css harus memiliki breakpoint tablet portrait');
    assert.ok(css.includes('@media (max-width: 767px)'), 'styles.css harus memiliki breakpoint mobile');

    const emojiRegex = /\p{Extended_Pictographic}/u;
    for (const [label, content] of [
      ['index.html', html],
      ['styles.css', css],
      ['app.js', appJs],
      ['charts.js', chartsJs],
    ]) {
      assert.equal(emojiRegex.test(content), false, `Ditemukan emoji terlarang di ${label}`);
    }

    const panelServerJs = fs.readFileSync(path.join(__dirname, '..', 'panel-server.js'), 'utf8');
    assert.equal(panelServerJs.includes('RakaPratama'), false, 'panel-server.js tidak boleh berisi dummy dataset');
    assert.equal(appJs.includes('RakaPratama'), false, 'app.js tidak boleh berisi dummy dataset');
  });

  // 2. Boot Database, Commands & Panel Server
  await initDatabase();
  const loadedCmds = loadCommands();
  let waStatus = 'online';

  attachBotRuntimeToPanel({
    getSock: () => ({
      user: { id: '62811000999@s.whatsapp.net' },
      sendMessage: async () => ({ key: { id: 'MSG-1' } }),
    }),
    getWaState: () => ({ status: waStatus, botJid: '62811000999@s.whatsapp.net', pairingCode: null }),
    connectWa: async () => {
      waStatus = 'online';
    },
    disconnectWa: async () => {
      waStatus = 'offline';
    },
    requestPairing: async (phone) => ({ ok: true, pairingCode: 'ABCD-1234', phone }),
    reloadCommands: () => {
      const r = loadCommands();
      return { commandsCount: r.count, aliasesCount: r.aliasCount };
    },
    getCommandsInfo: () => ({ commandsCount: loadedCmds.count, aliasesCount: loadedCmds.aliasCount }),
    getCommandsCatalog,
  });

  const srv = await startControlPanelServer({ port: 0 });
  const boundPort = srv.address().port;
  baseUrl = `http://127.0.0.1:${boundPort}`;

  // 3. Telemetry & Storage Collectors
  await step('Telemetry engine: real CPU %, RSS/Heap MB, Event-Loop ms, and SQLite/Disk metrics', () => {
    const sample = collectSample();
    assert.equal(typeof sample.cpu.processPct, 'number');
    assert.ok(sample.memory.rssMb > 10, 'RSS proses harus > 10 MB');
    assert.ok(sample.runtime.eventLoopMs >= 0, 'Event-loop latency harus >= 0 ms');

    const storage = measureStorage(true);
    assert.ok(storage.dbBytes > 0, 'Ukuran database harus terukur');
    assert.equal(typeof storage.diskTotalBytes, 'number');
  });

  // 4. Auth HMAC-SHA256 & Brute-force Rate Limiter
  await step('Security: unauthenticated API rejected (401) & tampered HMAC cookie rejected (401)', async () => {
    const statusCheck = await req('/api/auth/status', { cookie: '' });
    assert.equal(statusCheck.status, 200);
    assert.equal(statusCheck.data.authenticated, false);

    const unauth = await req('/api/overview', { cookie: '' });
    assert.equal(unauth.status, 401);

    const forged = await req('/api/overview', { cookie: 'cp_session=eyJ1IjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTk5OTl9.forgedsig' });
    assert.equal(forged.status, 401);
  });

  await step('Security: brute-force login limiter triggers HTTP 429 after 6 failed attempts', async () => {
    for (let i = 0; i < 6; i++) {
      const bad = await req('/api/auth/login', {
        method: 'POST',
        cookie: '',
        headers: { 'X-Forwarded-For': '198.51.100.77' },
        body: { username: 'admin', password: 'wrong-password' },
      });
      assert.equal(bad.status, 401);
    }
    const locked = await req('/api/auth/login', {
      method: 'POST',
      cookie: '',
      headers: { 'X-Forwarded-For': '198.51.100.77' },
      body: { username: 'admin', password: 'wrong-password' },
    });
    assert.equal(locked.status, 429);
  });

  await step('Authentication: valid login issues HttpOnly HMAC-SHA256 session cookie', async () => {
    const login = await req('/api/auth/login', {
      method: 'POST',
      cookie: '',
      body: { username: 'admin', password: process.env.PANEL_PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.ok(login.setCookie.includes('cp_session='));
    assert.ok(login.setCookie.includes('HttpOnly'));
    sessionCookie = decodeURIComponent(login.setCookie.split(';')[0]);
  });

  // 5. SSE Live Stream & Secret Redaction
  await step('SSE stream (/api/stream): delivers init frame + live redacted console frames', async () => {
    const sse = await openSseClient(sessionCookie);
    try {
      await new Promise((r) => setTimeout(r, 120));
      const initEv = sse.events.find((e) => e.event === 'init');
      assert.ok(initEv, 'SSE harus mengirim frame init');
      assert.ok(Array.isArray(initEv.data.telemetryHistory));
      assert.ok(Array.isArray(initEv.data.consoleBuffer));

      logger.info('SECURITY-TEST', `Attempting check with key ${process.env.PANEL_PASSWORD}`);
      await new Promise((r) => setTimeout(r, 120));

      const logEv = sse.events.find((e) => e.event === 'console' && e.data.scope === 'SECURITY-TEST');
      assert.ok(logEv, 'SSE harus meneruskan frame console secara real-time');
      assert.equal(logEv.data.message.includes(process.env.PANEL_PASSWORD), false, 'Password bocor ke SSE!');
      assert.ok(logEv.data.message.includes('[REDACTED]'), 'Password harus disensor menjadi [REDACTED]');
    } finally {
      sse.close();
    }
  });

  // 6. Overview, Power, Runtime Switches, Pairing & 89-Command Registry
  await step('Overview, Power, Runtime Switches & 89-Command Registry verified', async () => {
    const ov = await req('/api/overview');
    assert.equal(ov.status, 200);
    assert.equal(ov.data.overview.instance.commands.commandsCount, 89);

    const cmds = await req('/api/commands');
    assert.equal(cmds.status, 200);
    assert.equal(cmds.data.commands.length, 89);

    for (const ownerStrictName of ['tagall', 'hidetag', 'vps', 'sh']) {
      const cmdObj = cmds.data.commands.find((c) => c.name === ownerStrictName);
      assert.ok(cmdObj, `Command .${ownerStrictName} harus terdaftar di katalog panel`);
      assert.equal(cmdObj.ownerOnly, true, `.${ownerStrictName} wajib ownerOnly: true`);
      assert.equal(cmdObj.adminOnly, false, `.${ownerStrictName} wajib adminOnly: false`);
    }

    for (const staticAsset of ['/styles.css', '/charts.js', '/app.js']) {
      const assetRes = await req(staticAsset, { cookie: '' });
      assert.equal(assetRes.status, 200, `Static asset ${staticAsset} harus disajikan HTTP 200`);
    }

    const rtCfg = await req('/api/runtime/config', {
      method: 'POST',
      body: { botMode: 'self', maintenance: true, maintenanceReason: 'Upgrade node' },
    });
    assert.equal(rtCfg.status, 200);
    assert.equal(rtCfg.data.overview.instance.operational.botMode, 'self');
    assert.equal(rtCfg.data.overview.instance.operational.maintenance, true);

    await req('/api/runtime/config', {
      method: 'POST',
      body: { botMode: 'public', maintenance: false },
    });

    const pair = await req('/api/runtime/pairing', { method: 'POST', body: { phone: '6281234567890' } });
    assert.equal(pair.status, 200);
    assert.equal(pair.data.pairingCode, 'ABCD-1234');

    const disc = await req('/api/power', { method: 'POST', body: { action: 'disconnect' } });
    assert.equal(disc.status, 200);
    const conn = await req('/api/power', { method: 'POST', body: { action: 'connect' } });
    assert.equal(conn.status, 200);
  });

  // 7. Internal Console CLI
  await step('Internal Console CLI (/api/console/exec): executes real status, mem, cmd, addcoin, addvip, reload, checkpoint, backup', async () => {
    for (const cmd of [
      'help',
      'status',
      'mem',
      'cmd gacha',
      'addcoin 6281122334455 15000',
      'addvip 6281122334455 7d',
      'delvip 6281122334455',
      'reload',
      'checkpoint',
      'backup',
    ]) {
      const res = await req('/api/console/exec', { method: 'POST', body: { command: cmd } });
      assert.equal(res.status, 200, `CLI command "${cmd}" gagal`);
      assert.equal(res.data.ok, true);
    }
  });

  // 8. Users, Economy, VIP & Moderation
  await step('Users & Economy: real SQLite /api/users/ensure, coin add/deduct, Sakura VIP, and ban/unban', async () => {
    const ens = await req('/api/users/ensure', {
      method: 'POST',
      body: { phone: '089988776655', name: 'TesterCipi' },
    });
    assert.equal(ens.status, 200);
    const targetJid = ens.data.jid;
    assert.equal(targetJid, '6289988776655@s.whatsapp.net');

    await req('/api/users/coins', { method: 'POST', body: { jid: targetJid, delta: 25000 } });
    await req('/api/users/coins', { method: 'POST', body: { jid: targetJid, delta: -5000 } });
    await req('/api/users/vip', { method: 'POST', body: { jid: targetJid, duration: '14d' } });
    await req('/api/users/ban', { method: 'POST', body: { jid: targetJid, reason: 'Uji moderasi' } });

    const list = await req(`/api/users?q=${encodeURIComponent('6289988776655')}`);
    assert.equal(list.status, 200);
    const u = list.data.users.find((x) => x.jid === targetJid);
    assert.ok(u);
    // Starting balance (500) + 25000 - 5000 = 20500
    assert.equal(u.balance, 20500);
    assert.equal(u.isVip, true);
    assert.equal(u.isBanned, true);

    await req('/api/users/vip', { method: 'POST', body: { jid: targetJid, action: 'revoke' } });
    await req('/api/users/ban', { method: 'POST', body: { jid: targetJid, action: 'unban' } });
  });

  // 9. Minecraft RCON Whitelist Enforcement
  await step('Minecraft RCON policy: blocks unwhitelisted commands (403) & permits whitelisted commands', async () => {
    const blocked = await req('/api/minecraft/console', { method: 'POST', body: { command: 'op GrieferAccount' } });
    assert.equal(blocked.status, 403);

    const allowed = await req('/api/minecraft/console', { method: 'POST', body: { command: 'list' } });
    assert.notEqual(allowed.status, 403, 'Whitelisted command tidak boleh ditolak 403');
  });

  // 10. Broadcast, Tickets, Backups, WAL Checkpoint & Audit Logs
  await step('Broadcast, Tickets, SQLite Snapshot Download, WAL Checkpoint & Audit Trail', async () => {
    const db = getDb();
    const now = Date.now();
    db.run(
      `INSERT INTO tickets (ticket_no, jid, user_name, category, subject, message, status, created_at, updated_at)
       VALUES ('TKT-9001', '6289988776655@s.whatsapp.net', 'TesterCipi', 'umum', 'Tes Panel', 'Tes tiket panel', 'open', ?, ?)`,
      [now, now]
    );

    const bc = await req('/api/broadcast', {
      method: 'POST',
      body: { targetMode: 'all', message: 'Pengumuman pemeliharaan rutin node CipiSMP' },
    });
    assert.equal(bc.status, 200);

    const comm = await req('/api/community');
    assert.equal(comm.status, 200);
    assert.ok(comm.data.tickets.some((t) => t.ticketNo === 'TKT-9001'));

    const closeTkt = await req('/api/tickets/close', {
      method: 'POST',
      body: { ticketNo: 'TKT-9001', resolution: 'Selesai diuji' },
    });
    assert.equal(closeTkt.status, 200);

    const cp = await req('/api/storage/checkpoint', { method: 'POST' });
    assert.equal(cp.status, 200);

    const snap = await req('/api/backups/create', { method: 'POST' });
    assert.equal(snap.status, 200);

    const backups = await req('/api/backups');
    assert.ok(backups.data.backups.length >= 1);
    assert.equal(backups.data.tables.length, 14);

    // Path traversal attempt must fail
    const traversal = await req('/api/backups/download?file=../../package.json');
    assert.equal(traversal.status, 400);

    // Valid SQLite snapshot download check
    const dl = await req(`/api/backups/download?file=${encodeURIComponent(backups.data.backups[0].name)}`, {
      binary: true,
    });
    assert.equal(dl.status, 200);
    assert.equal(dl.rawBuffer.subarray(0, 15).toString('utf8'), 'SQLite format 3');

    const audit = await req('/api/audit?limit=50');
    assert.equal(audit.status, 200);
    assert.ok(audit.data.logs.length >= 5);
  });

  // 10. VPS Host Control & Stateful Linux Shell Terminal (/api/vps/*)
  await step('VPS Host Control & Linux Shell Terminal: auth gate, real telemetry, stateful CWD, secret redaction & safety guards', async () => {
    const unauthVps = await req('/api/vps/overview', { cookie: '' });
    assert.equal(unauthVps.status, 401);

    const unauthExec = await req('/api/vps/exec', {
      method: 'POST',
      cookie: '',
      body: { command: 'whoami' },
    });
    assert.equal(unauthExec.status, 401);

    const vpsOv = await req('/api/vps/overview');
    assert.equal(vpsOv.status, 200);
    assert.ok(vpsOv.data.vps.host.hostname.length > 0);
    assert.ok(vpsOv.data.vps.memory.totalBytes > 0);
    assert.ok(Array.isArray(vpsOv.data.vps.disks) && vpsOv.data.vps.disks.length >= 1);
    assert.ok(Array.isArray(vpsOv.data.vps.processes) && vpsOv.data.vps.processes.length >= 1);

    // Stateful CWD across terminal commands + secret redaction
    const cdRes = await req('/api/vps/exec', {
      method: 'POST',
      body: { command: 'cd /tmp' },
    });
    assert.equal(cdRes.status, 200);
    assert.equal(cdRes.data.state.cwd, '/tmp');

    const pwdRes = await req('/api/vps/exec', {
      method: 'POST',
      body: { command: `pwd && echo "SECRET=${process.env.PANEL_PASSWORD}"` },
    });
    assert.equal(pwdRes.status, 200);
    assert.ok(pwdRes.data.stdout.includes('/tmp'), 'CWD /tmp wajib persisten');
    assert.equal(
      pwdRes.data.stdout.includes(process.env.PANEL_PASSWORD),
      false,
      'PANEL_PASSWORD wajib otomatis di-redact dari output terminal'
    );

    // Block catastrophic rm -rf / and block killing panel's own PID
    const blockedRm = await req('/api/vps/exec', {
      method: 'POST',
      body: { command: 'rm -rf /' },
    });
    assert.equal(blockedRm.status, 400);

    const blockedSelfKill = await req('/api/vps/kill', {
      method: 'POST',
      body: { pid: process.pid, signal: 'SIGTERM' },
    });
    assert.equal(blockedSelfKill.status, 400);

    const resetRes = await req('/api/vps/reset', { method: 'POST' });
    assert.equal(resetRes.status, 200);
    assert.notEqual(resetRes.data.state.cwd, '/tmp');

    const vpsAudit = await req('/api/audit?limit=20&category=vps_control');
    assert.equal(vpsAudit.status, 200);
    assert.ok(vpsAudit.data.logs.length >= 2, 'Audit log vps_control wajib tercatat');
  });

  // ─── 14. Full Interactive WebSocket PTY (/api/vps/pty + xterm.js) ───
  await step('Full Interactive SSH-Grade WebSocket PTY (/api/vps/pty, /dev/pts, TIOCSWINSZ, [Y/n])', async () => {
    const { WebSocket } = require('ws');

    for (const asset of ['/vendor/xterm.js', '/vendor/addon-fit.js', '/vendor/xterm.css']) {
      const assetRes = await req(asset, { cookie: '' });
      assert.equal(assetRes.status, 200, `Vendor asset ${asset} wajib HTTP 200`);
      assert.ok(assetRes.data.length > 500, `Vendor asset ${asset} tidak boleh kosong`);
    }

    const wsBase = baseUrl.replace(/^http/, 'ws');

    // 1) Unauthenticated WebSocket upgrade MUST be rejected with 401
    await new Promise((resolve, reject) => {
      const unauthWs = new WebSocket(`${wsBase}/api/vps/pty?cols=80&rows=24`);
      unauthWs.on('unexpected-response', (_req, res) => {
        assert.equal(res.statusCode, 401, 'WebSocket tanpa sesi wajib ditolak 401');
        res.resume();
        resolve();
      });
      unauthWs.on('open', () => {
        unauthWs.close();
        reject(new Error('Unauthenticated WebSocket PTY seharusnya ditolak!'));
      });
      unauthWs.on('error', () => {});
    });

    // 2) Authenticated WebSocket PTY session: /dev/pts/* + live resize + interactive prompt
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/api/vps/pty?cols=90&rows=26`, {
        headers: { Cookie: sessionCookie },
      });
      let outBuf = '';
      let readyMeta = null;
      let sentPromptReply = false;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timeout menunggu output PTY. Buffer sejauh ini:\n${outBuf}`));
      }, 6000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'resize', cols: 136, rows: 42 }));
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: 'input',
              data: 'tty && stty size && read -p "SSH_PROMPT_YN:" yn && echo "PTY_OK=$yn"\r',
            })
          );
        }, 120);
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf8'));
        if (msg.type === 'ready') {
          readyMeta = msg;
        } else if (msg.type === 'output') {
          outBuf += msg.data;
          if (!sentPromptReply && outBuf.includes('SSH_PROMPT_YN:')) {
            sentPromptReply = true;
            ws.send(JSON.stringify({ type: 'input', data: 'Y_INTERACTIVE\r' }));
          }
          if (outBuf.includes('PTY_OK=Y_INTERACTIVE')) {
            clearTimeout(timer);
            assert.ok(readyMeta && String(readyMeta.tty).startsWith('/dev/pts/'), 'Wajib alokasi /dev/pts/* asli');
            assert.ok(outBuf.includes('/dev/pts/'), 'Output tty wajib /dev/pts/*');
            assert.ok(outBuf.includes('42 136'), `Ukuran stty wajib 42 136:\n${outBuf}`);
            ws.close();
            resolve();
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });

  // ─── 15. Reverse-Proxy Safe SSE + HTTP Duplex PTY Fallback (/api/vps/pty/stream) ───
  await step('Reverse-Proxy SSE + HTTP Duplex PTY Fallback (/api/vps/pty/stream, /input, /resize)', async () => {
    const unauthStream = await req('/api/vps/pty/stream?cols=80&rows=24', { cookie: '' });
    assert.equal(unauthStream.status, 401);

    await new Promise((resolve, reject) => {
      const parsed = new URL(`${baseUrl}/api/vps/pty/stream?cols=88&rows=24`);
      let sid = '';
      let outBuf = '';
      let sentCmd = false;
      const timer = setTimeout(() => {
        clientReq.destroy();
        reject(new Error(`Timeout SSE PTY fallback:\n${outBuf}`));
      }, 6000);

      const clientReq = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { Cookie: sessionCookie },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', async (chunk) => {
            buf += chunk;
            const frames = buf.split('\n\n');
            buf = frames.pop() || '';
            for (const f of frames) {
              let ev = '';
              let rawData = '';
              for (const line of f.split('\n')) {
                if (line.startsWith('event:')) ev = line.slice(6).trim();
                if (line.startsWith('data:')) rawData += line.slice(5).trim();
              }
              if (!rawData) continue;
              const msg = JSON.parse(rawData);
              if ((ev === 'session' || ev === 'ready') && msg.sessionId) {
                sid = msg.sessionId;
              }
              if (ev === 'ready' && !sentCmd && sid) {
                sentCmd = true;
                await req('/api/vps/pty/resize', {
                  method: 'POST',
                  body: { sessionId: sid, cols: 124, rows: 38 },
                });
                await new Promise((r) => setTimeout(r, 60));
                await req('/api/vps/pty/input', {
                  method: 'POST',
                  body: { sessionId: sid, data: 'stty size && printf "SSE_PTY_%s\\n" "READY_OK"\r' },
                });
              }
              if (ev === 'output' && msg.data) {
                outBuf += msg.data;
                if (outBuf.includes('SSE_PTY_READY_OK')) {
                  clearTimeout(timer);
                  assert.ok(outBuf.includes('38 124'), `stty size wajib 38 124:\n${outBuf}`);
                  clientReq.destroy();
                  resolve();
                }
              }
            }
          });
        }
      );
      clientReq.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      clientReq.end();
    });
  });

  // 13. Locked Desktop Sidebar + Separated Bot vs Real VPS Telemetry & Responsive Breakpoints
  await step('Desktop sidebar scroll-lock + Separated Bot (#view-console) vs Real VPS (#view-vps) telemetry', async () => {
    const htmlRes = await req('/', { cookie: '' });
    assert.equal(htmlRes.status, 200);
    const html = htmlRes.data;

    // #botMetricsStrip must sit strictly inside #view-console, and #vpsMetricsStrip strictly inside #view-vps
    const idxConsoleView = html.indexOf('id="view-console"');
    const idxBotStrip = html.indexOf('id="botMetricsStrip"');
    const idxRuntimeView = html.indexOf('id="view-runtime"');
    const idxVpsView = html.indexOf('id="view-vps"');
    const idxVpsStrip = html.indexOf('id="vpsMetricsStrip"');
    const idxAuditView = html.indexOf('id="view-audit"');

    assert.ok(idxConsoleView > 0 && idxBotStrip > idxConsoleView && idxBotStrip < idxRuntimeView,
      '#botMetricsStrip wajib berada di dalam #view-console saja');
    assert.ok(idxVpsView > 0 && idxVpsStrip > idxVpsView && idxVpsStrip < idxAuditView,
      '#vpsMetricsStrip wajib berada di dalam #view-vps saja');
    assert.ok(html.includes('Bot CPU (Node Process)') && html.includes('Bot Memory (Node RSS)'));
    assert.ok(html.includes('VPS CPU &amp; vCPU Cores') && html.includes('VPS Physical RAM (Spec)'));
    assert.ok(html.includes('id="vpsMetricCpuVal"') && html.includes('id="vpsMetricRamVal"') && html.includes('id="vpsMetricDiskVal"') && html.includes('id="vpsMetricSwapVal"'));

    const cssRes = await req('/styles.css', { cookie: '' });
    assert.equal(cssRes.status, 200);
    assert.ok(cssRes.data.includes('overflow-x: clip;'), 'html, body wajib memakai overflow-x: clip agar tidak merusak sticky/scroll lock');
    assert.ok(cssRes.data.includes('.app-shell > .sidebar') && cssRes.data.includes('.app-shell > .workspace'),
      'Desktop .app-shell wajib memisahkan scroll container .sidebar dan .workspace');

    const jsRes = await req('/app.js', { cookie: '' });
    assert.equal(jsRes.status, 200);
    assert.ok(jsRes.data.includes('function updateVpsMetricsStrip(') && jsRes.data.includes('function formatCompactPair('));

    const ov = await req('/api/overview');
    assert.equal(ov.status, 200);
    const t = ov.data.overview.telemetry;
    assert.ok(t && typeof t.cpu.hostCpuPct === 'number', 'telemetry.cpu.hostCpuPct wajib angka akurat dari /proc/stat');
    assert.ok(t.memory.osTotalBytes > 0 && t.memory.osUsedBytes > 0, 'telemetry.memory.osTotalBytes & osUsedBytes wajib sesuai spesifikasi RAM fisik VPS');
    assert.ok(typeof t.runtime.pid === 'number' && t.runtime.pid > 0, 'telemetry.runtime.pid wajib tersedia untuk statistik proses Bot');
    assert.ok(t.host && t.host.cpuModel && t.host.distro, 'telemetry.host wajib memuat spesifikasi CPU & OS VPS');
  });

  await stopControlPanelServer();
  closeDatabase();
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  SUCCESS: ${passed}/${passed} Cipi Panel (CP) test suites passed!`);
  console.log('══════════════════════════════════════════════════════════\n');
}

main().catch(async (err) => {
  await stopControlPanelServer().catch(() => {});
  closeDatabase();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
});
