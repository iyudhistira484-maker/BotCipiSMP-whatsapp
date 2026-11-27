const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const config = require('../config');
const { addAuditLog } = require('./database');
const { redactSecrets } = require('./owner-manager');
const { collectSample } = require('./telemetry');

const ROOT_DIR = path.resolve(__dirname, '..');
const SHELL_BINARY = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 120 * 1000;
const SENTINEL_TAG = '__CIPI_SENTINEL_PWD__:';

/**
 * State sesi terminal per-aktor (misal "wa:628xxx@s.whatsapp.net" atau "panel:admin")
 */
const terminalSessions = new Map();

function getOrCreateSession(sessionKey = 'default') {
  const key = String(sessionKey || 'default');
  let sess = terminalSessions.get(key);
  if (!sess) {
    sess = {
      key,
      cwd: fs.existsSync(ROOT_DIR) ? ROOT_DIR : process.cwd(),
      runningChild: null,
      runningPid: null,
      runningCommand: '',
      runningStartedAt: 0,
      lastExitCode: 0,
      execCount: 0,
    };
    terminalSessions.set(key, sess);
  }
  if (!sess.cwd || !fs.existsSync(sess.cwd)) {
    sess.cwd = fs.existsSync(ROOT_DIR) ? ROOT_DIR : process.cwd();
  }
  return sess;
}

function getSessionState(sessionKey = 'default') {
  const sess = getOrCreateSession(sessionKey);
  const home = os.homedir();
  const displayCwd =
    home && sess.cwd.startsWith(home)
      ? `~${sess.cwd.slice(home.length) || ''}`
      : sess.cwd;

  let username = 'operator';
  try {
    username = os.userInfo().username || 'operator';
  } catch {
    username = process.env.USER || 'operator';
  }

  return {
    key: sess.key,
    user: username,
    hostname: os.hostname(),
    cwd: sess.cwd,
    displayCwd: displayCwd || '~',
    shell: path.basename(SHELL_BINARY),
    running: Boolean(sess.runningChild),
    runningPid: sess.runningPid,
    runningCommand: sess.runningCommand,
    runningElapsedMs: sess.runningStartedAt ? Math.max(0, Date.now() - sess.runningStartedAt) : 0,
    lastExitCode: sess.lastExitCode,
    execCount: sess.execCount,
  };
}

/**
 * Bersihkan kode warna ANSI & carriage-return overwrite agar rapi di WA dan Web Panel
 */
function cleanTerminalText(raw = '') {
  return String(raw || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/^.*\r(?!\n)/gm, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/**
 * Cegah perintah destruktif fatal (hapus root disk / format blok / fork bomb)
 */
function checkCatastrophicCommand(command = '') {
  const normalized = String(command || '').trim();
  const patterns = [
    {
      re: /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--no-preserve-root)\s+(?:\/|\/\*|\$HOME|~)\s*(?:$|[;&|])/i,
      reason: 'Perintah penghapusan root filesystem (`rm -rf /`) diblokir otomatis demi keselamatan VPS.',
    },
    {
      re: /(?:^|[;&|]\s*)(?:sudo\s+)?(?:mkfs(?:\.[a-z0-9]+)?|wipefs|fdisk|parted)\b/i,
      reason: 'Perintah pemformatan partisi disk (`mkfs`/`wipefs`/`fdisk`) diblokir dari remote terminal.',
    },
    {
      re: /(?:^|[;&|]\s*)(?:sudo\s+)?dd\s+[^;&|]*\bof=\/dev\/(?:sd|vd|nvme|xvd|mmcblk|loop)/i,
      reason: 'Penulisan mentah `dd` langsung ke block device `/dev/...` diblokir.',
    },
    {
      re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
      reason: 'Pola fork-bomb terdeteksi dan diblokir otomatis.',
    },
  ];

  for (const item of patterns) {
    if (item.re.test(normalized)) {
      return { blocked: true, reason: item.reason };
    }
  }

  if (
    config.dryRun &&
    /(?:^|[;&|]\s*)(?:sudo\s+)?(?:reboot|shutdown|poweroff|halt|init\s+[06])\b/i.test(normalized)
  ) {
    return {
      blocked: true,
      reason: 'Mode DRY_RUN aktif: perintah power host (`reboot`/`shutdown`) disimulasikan tanpa mematikan mesin.',
    };
  }

  return { blocked: false };
}

/**
 * Deteksi aplikasi full-screen TTY interaktif (curses) agar tidak menggantung tanpa keyboard
 */
function detectInteractiveTuiTrap(command = '') {
  const trimmed = String(command || '').trim();
  if (/^(?:sudo\s+)?(?:htop|btop|atop|nload|iftop|ncdu|mc|tmux|screen)(?:\s+.*)?$/i.test(trimmed)) {
    return 'Program TUI layar penuh tidak mendukung mode non-TTY. Gunakan perintah batch seperti `ps aux --sort=-%cpu | head -n 15` atau `free -h`.';
  }
  if (/^(?:sudo\s+)?(?:nano|vim|vi|nvim|emacs|less|more)(?:\s+.*)?$/i.test(trimmed)) {
    return 'Editor/pager interaktif membutuhkan layar TTY langsung. Gunakan `cat`, `head`, `tail`, `grep`, atau `sed` untuk membaca/mengubah file.';
  }
  if (/^(?:sudo\s+)?top\s*$/i.test(trimmed)) {
    return 'Perintah `top` tanpa flag bersifat interaktif terus-menerus. Gunakan `top -bn1 | head -n 22` untuk mengambil snapshot CPU/proses.';
  }
  return null;
}

function killProcessGroupSafe(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Proses sudah berhenti
    }
  }
}

/**
 * Hentikan paksa perintah yang sedang berjalan pada sesi tertentu
 */
function abortSessionCommand(sessionKey = 'default', actorJid = 'owner') {
  const sess = getOrCreateSession(sessionKey);
  if (!sess.runningChild) {
    return { ok: false, aborted: false, message: 'Tidak ada perintah terminal yang sedang berjalan.' };
  }

  const targetCmd = sess.runningCommand;
  const targetPid = sess.runningPid;
  const child = sess.runningChild;

  killProcessGroupSafe(child, 'SIGTERM');
  setTimeout(() => killProcessGroupSafe(child, 'SIGKILL'), 600).unref?.();

  addAuditLog({
    level: 'warn',
    category: 'vps_control',
    actorJid,
    target: `pid:${targetPid || 0}`,
    action: 'abort_shell_command',
    details: { command: redactSecrets(targetCmd).slice(0, 140) },
  });

  return {
    ok: true,
    aborted: true,
    pid: targetPid,
    command: targetCmd,
  };
}

/**
 * Reset direktori kerja (CWD) sesi kembali ke folder utama bot & hentikan proses gantung
 */
function resetSessionState(sessionKey = 'default', actorJid = 'owner') {
  const sess = getOrCreateSession(sessionKey);
  if (sess.runningChild) {
    abortSessionCommand(sessionKey, actorJid);
  }
  sess.cwd = fs.existsSync(ROOT_DIR) ? ROOT_DIR : process.cwd();
  sess.lastExitCode = 0;
  return getSessionState(sessionKey);
}

/**
 * Eksekusi perintah shell Linux di VPS dengan pelacakan CWD otomatis, batas waktu, & redaksi secret
 */
async function executeVpsCommand({
  sessionKey = 'default',
  actorJid = 'owner',
  source = 'whatsapp',
  command = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redactOutput = true,
} = {}) {
  const rawCommand = String(command || '').trim();
  if (!rawCommand) {
    return {
      ok: false,
      reason: 'empty_command',
      error: 'Perintah terminal kosong.',
      state: getSessionState(sessionKey),
    };
  }

  const sess = getOrCreateSession(sessionKey);
  if (sess.runningChild) {
    return {
      ok: false,
      reason: 'busy',
      error: `Masih ada proses yang sedang berjalan (PID ${sess.runningPid}: "${sess.runningCommand.slice(0, 60)}"). Hentikan dulu bila ingin membatalkan.`,
      state: getSessionState(sessionKey),
    };
  }

  const catastrophic = checkCatastrophicCommand(rawCommand);
  if (catastrophic.blocked) {
    addAuditLog({
      level: 'warn',
      category: 'vps_control',
      actorJid,
      target: sess.cwd,
      action: 'blocked_dangerous_shell',
      details: { source, command: redactSecrets(rawCommand).slice(0, 160), reason: catastrophic.reason },
    });
    return {
      ok: false,
      reason: 'blocked_dangerous',
      error: catastrophic.reason,
      state: getSessionState(sessionKey),
    };
  }

  const tuiWarning = detectInteractiveTuiTrap(rawCommand);
  if (tuiWarning) {
    return {
      ok: false,
      reason: 'interactive_tui',
      error: tuiWarning,
      state: getSessionState(sessionKey),
    };
  }

  const clampedTimeout = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(2000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
  );

  const wrappedScript = [
    rawCommand,
    '__cipi_ec=$?',
    `printf '\\n${SENTINEL_TAG}%s:%d\\n' "$PWD" "$__cipi_ec"`,
    'exit $__cipi_ec',
  ].join('\n');

  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdoutChunks = [];
    let stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let finished = false;

    let child;
    try {
      child = spawn(SHELL_BINARY, ['-c', wrappedScript], {
        cwd: sess.cwd,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'dumb',
          COLUMNS: '120',
          LINES: '40',
          DEBIAN_FRONTEND: 'noninteractive',
          GIT_TERMINAL_PROMPT: '0',
          PAGER: 'cat',
        },
      });
    } catch (spawnErr) {
      resolve({
        ok: false,
        reason: 'spawn_error',
        error: spawnErr.message || String(spawnErr),
        state: getSessionState(sessionKey),
      });
      return;
    }

    sess.runningChild = child;
    sess.runningPid = child.pid || null;
    sess.runningCommand = rawCommand;
    sess.runningStartedAt = startedAt;
    sess.execCount += 1;

    const timer = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      killProcessGroupSafe(child, 'SIGTERM');
      setTimeout(() => killProcessGroupSafe(child, 'SIGKILL'), 800).unref?.();
    }, clampedTimeout);

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        const remain = MAX_OUTPUT_BYTES - stdoutBytes;
        const slice = chunk.length > remain ? chunk.subarray(0, remain) : chunk;
        stdoutChunks.push(slice);
        stdoutBytes += slice.length;
        if (chunk.length > remain) outputTruncated = true;
      } else {
        outputTruncated = true;
        if (stdoutBytes + stderrBytes >= MAX_OUTPUT_BYTES * 2) {
          killProcessGroupSafe(child, 'SIGTERM');
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        const remain = MAX_OUTPUT_BYTES - stderrBytes;
        const slice = chunk.length > remain ? chunk.subarray(0, remain) : chunk;
        stderrChunks.push(slice);
        stderrBytes += slice.length;
        if (chunk.length > remain) outputTruncated = true;
      } else {
        outputTruncated = true;
      }
    });

    const finalize = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      sess.runningChild = null;
      sess.runningPid = null;
      sess.runningCommand = '';
      sess.runningStartedAt = 0;

      const durationMs = Math.max(1, Date.now() - startedAt);
      let rawOut = Buffer.concat(stdoutChunks).toString('utf8');
      let rawErr = Buffer.concat(stderrChunks).toString('utf8');

      let resolvedExitCode = typeof code === 'number' ? code : signal ? 130 : 0;

      // Ekstrak sentinel direktori kerja baru bila ada
      const sentinelIdx = rawOut.lastIndexOf(SENTINEL_TAG);
      if (sentinelIdx !== -1) {
        const lineEnd = rawOut.indexOf('\n', sentinelIdx);
        const sentinelLine = (
          lineEnd === -1 ? rawOut.slice(sentinelIdx) : rawOut.slice(sentinelIdx, lineEnd)
        ).trim();
        const payload = sentinelLine.slice(SENTINEL_TAG.length);
        const lastColon = payload.lastIndexOf(':');
        if (lastColon > 0) {
          const detectedPwd = payload.slice(0, lastColon);
          const detectedCode = Number.parseInt(payload.slice(lastColon + 1), 10);
          if (detectedPwd && fs.existsSync(detectedPwd)) {
            sess.cwd = detectedPwd;
          }
          if (Number.isFinite(detectedCode)) {
            resolvedExitCode = detectedCode;
          }
        }
        const cutBefore = sentinelIdx > 0 && rawOut[sentinelIdx - 1] === '\n' ? sentinelIdx - 1 : sentinelIdx;
        rawOut = rawOut.slice(0, cutBefore) + (lineEnd === -1 ? '' : rawOut.slice(lineEnd + 1));
      }

      sess.lastExitCode = resolvedExitCode;

      let cleanOut = cleanTerminalText(rawOut).trimEnd();
      let cleanErr = cleanTerminalText(rawErr).trimEnd();
      if (redactOutput) {
        cleanOut = redactSecrets(cleanOut);
        cleanErr = redactSecrets(cleanErr);
      }
      if (outputTruncated) {
        cleanErr = `${cleanErr ? `${cleanErr}\n` : ''}[Output dipangkas pada batas aman 256 KB]`;
      }
      if (timedOut) {
        cleanErr = `${cleanErr ? `${cleanErr}\n` : ''}[Proses dihentikan otomatis karena melewati batas waktu ${(
          clampedTimeout / 1000
        ).toFixed(0)} detik]`;
      }

      const combined = [cleanOut, cleanErr].filter(Boolean).join('\n');

      addAuditLog({
        level: resolvedExitCode === 0 && !timedOut ? 'info' : 'warn',
        category: 'vps_control',
        actorJid,
        target: sess.cwd,
        action: 'exec_shell',
        details: {
          source,
          command: redactSecrets(rawCommand).slice(0, 180),
          exitCode: resolvedExitCode,
          timedOut,
          durationMs,
        },
      });

      resolve({
        ok: true,
        command: rawCommand,
        exitCode: resolvedExitCode,
        signal: signal || null,
        timedOut,
        truncated: outputTruncated,
        durationMs,
        stdout: cleanOut,
        stderr: cleanErr,
        combined,
        state: getSessionState(sessionKey),
      });
    };

    child.on('close', finalize);
    child.on('error', (err) => {
      stderrChunks.push(Buffer.from(String(err.message || err), 'utf8'));
      finalize(1, null);
    });
  });
}

// =====================================================================
// TELEMETRI HOST VPS REAL-TIME (OS, RAM/SWAP, DISK, NETWORK, PROSES)
// =====================================================================

function execQuickFile(bin, args = [], timeout = 3500) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => {
        if (err) return resolve('');
        resolve(String(stdout || ''));
      }
    );
  });
}

function readLinuxDistroName() {
  try {
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf8');
      const match = content.match(/^PRETTY_NAME="?([^"\r\n]+)"?/m);
      if (match && match[1]) return match[1].trim();
    }
  } catch {
    // Fallback os.type()
  }
  return `${os.type()} ${os.release()}`;
}

function readHostMemoryDetails() {
  const totalFallback = os.totalmem();
  const freeFallback = os.freemem();
  try {
    if (fs.existsSync('/proc/meminfo')) {
      const raw = fs.readFileSync('/proc/meminfo', 'utf8');
      const map = Object.create(null);
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)\s*kB/i);
        if (m) map[m[1]] = Number(m[2]) * 1024;
      }
      const totalBytes = map.MemTotal || totalFallback;
      const availBytes =
        map.MemAvailable ??
        ((map.MemFree || 0) + (map.Buffers || 0) + (map.Cached || 0) || freeFallback);
      const usedBytes = Math.max(0, totalBytes - availBytes);
      const swapTotalBytes = map.SwapTotal || 0;
      const swapFreeBytes = map.SwapFree || 0;
      const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
      return {
        totalBytes,
        usedBytes,
        availableBytes: availBytes,
        usedPct: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0,
        swapTotalBytes,
        swapUsedBytes,
        swapUsedPct:
          swapTotalBytes > 0 ? Number(((swapUsedBytes / swapTotalBytes) * 100).toFixed(1)) : 0,
      };
    }
  } catch {
    // Fallback os module
  }

  const used = Math.max(0, totalFallback - freeFallback);
  return {
    totalBytes: totalFallback,
    usedBytes: used,
    availableBytes: freeFallback,
    usedPct: totalFallback > 0 ? Number(((used / totalFallback) * 100).toFixed(1)) : 0,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
    swapUsedPct: 0,
  };
}

function getNetworkInterfacesList() {
  const nets = os.networkInterfaces() || {};
  const list = [];
  for (const [iface, entries] of Object.entries(nets)) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      if (!item || item.internal) continue;
      list.push({
        iface,
        family: item.family === 4 || item.family === 'IPv4' ? 'IPv4' : 'IPv6',
        address: item.address,
        cidr: item.cidr || item.address,
        mac: item.mac || '',
      });
    }
  }
  return list;
}

async function listMountedDisks() {
  const out = await execQuickFile('df', ['-P', '-B1']);
  const disks = [];
  if (out) {
    const lines = out.trim().split('\n').slice(1);
    const seenMounts = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [filesystem, totalStr, usedStr, availStr, capStr, ...mountParts] = parts;
      const mount = mountParts.join(' ');
      if (seenMounts.has(mount)) continue;

      const isRoot = mount === '/';
      const isPseudo =
        /^(?:tmpfs|devtmpfs|udev|proc|sysfs|cgroup|shm|nsfs|squashfs)/i.test(filesystem) ||
        /^\/(?:dev|proc|sys|run|snap)(?:\/|$)/.test(mount);
      if (!isRoot && isPseudo) continue;

      const totalBytes = Number(totalStr) || 0;
      const usedBytes = Number(usedStr) || 0;
      const freeBytes = Number(availStr) || 0;
      if (totalBytes <= 0) continue;

      seenMounts.add(mount);
      disks.push({
        filesystem,
        mount,
        totalBytes,
        usedBytes,
        freeBytes,
        usedPct:
          Number.parseFloat(String(capStr).replace('%', '')) ||
          Number(((usedBytes / totalBytes) * 100).toFixed(1)),
      });
    }
  }

  if (disks.length === 0 && typeof fs.statfsSync === 'function') {
    try {
      const st = fs.statfsSync(ROOT_DIR);
      const bsize = Number(st.bsize || st.frsize || 4096);
      const totalBytes = Number(st.blocks || 0) * bsize;
      const freeBytes = Number(st.bavail || st.bfree || 0) * bsize;
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      if (totalBytes > 0) {
        disks.push({
          filesystem: 'rootfs',
          mount: '/',
          totalBytes,
          usedBytes,
          freeBytes,
          usedPct: Number(((usedBytes / totalBytes) * 100).toFixed(1)),
        });
      }
    } catch {
      // Abaikan
    }
  }

  return disks.slice(0, 8);
}

async function listTopVpsProcesses(limit = 16) {
  const out = await execQuickFile('ps', [
    '-eo',
    'pid,user,pcpu,pmem,rss,etime,comm,args',
    '--sort=-pcpu',
  ]);
  if (!out) return [];

  const rows = [];
  const lines = out.trim().split('\n').slice(1);
  for (const line of lines) {
    const m = line
      .trim()
      .match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    rows.push({
      pid,
      user: m[2],
      cpuPct: Number(m[3]) || 0,
      memPct: Number(m[4]) || 0,
      rssMb: Number((Number(m[5] || 0) / 1024).toFixed(1)),
      elapsed: m[6],
      command: m[7],
      args: redactSecrets(String(m[8] || m[7]).trim()).slice(0, 140),
      isSelf: pid === process.pid,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

async function listPm2Processes() {
  const out = await execQuickFile('pm2', ['jlist'], 3000);
  if (!out || !out.trim().startsWith('[')) return [];
  try {
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).map((proc) => ({
      pmId: proc.pm_id,
      name: proc.name || 'app',
      pid: proc.pid || 0,
      status: proc.pm2_env?.status || 'unknown',
      restarts: proc.pm2_env?.restart_time || 0,
      uptimeMs: proc.pm2_env?.pm_uptime ? Math.max(0, Date.now() - proc.pm2_env.pm_uptime) : 0,
      cpuPct: Number(proc.monit?.cpu || 0),
      memMb: Number(((proc.monit?.memory || 0) / (1024 * 1024)).toFixed(1)),
    }));
  } catch {
    return [];
  }
}

async function fetchPublicIpSafe() {
  if (config.dryRun) return null;
  for (const endpoint of ['https://api.ipify.org?format=json', 'https://ifconfig.me/ip']) {
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (text.startsWith('{')) {
        const parsed = JSON.parse(text);
        if (parsed?.ip) return String(parsed.ip).trim();
      } else if (/^[0-9a-fA-F.:]{7,45}$/.test(text)) {
        return text;
      }
    } catch {
      // Coba endpoint berikutnya
    }
  }
  return null;
}

/**
 * Terminasi proses di VPS secara aman (menolak PID <= 1 & menolak mematikan proses bot sendiri tanpa sengaja)
 */
function killVpsProcess({ pid, signal = 'SIGTERM', actorJid = 'owner', source = 'panel' } = {}) {
  const numPid = Number.parseInt(String(pid), 10);
  if (!Number.isFinite(numPid) || numPid <= 1) {
    return { ok: false, error: 'PID tidak valid atau dilindungi oleh kernel (PID <= 1).' };
  }
  if (numPid === process.pid) {
    return {
      ok: false,
      error: `PID ${numPid} adalah proses utama Bot/Panel yang sedang aktif. Gunakan fitur Restart Bot bila ingin memuat ulang.`,
    };
  }

  const safeSignal = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(numPid, safeSignal);
    addAuditLog({
      level: 'warn',
      category: 'vps_control',
      actorJid,
      target: `pid:${numPid}`,
      action: 'kill_process',
      details: { source, signal: safeSignal },
    });
    return { ok: true, pid: numPid, signal: safeSignal };
  } catch (err) {
    return {
      ok: false,
      error:
        err.code === 'ESRCH'
          ? `Proses dengan PID ${numPid} sudah tidak ditemukan.`
          : err.code === 'EPERM'
            ? `Izin ditolak (EPERM) untuk menghentikan PID ${numPid}.`
            : err.message || String(err),
    };
  }
}

async function getVpsSystemSnapshot({
  sessionKey = 'default',
  includePublicIp = false,
  processLimit = 16,
} = {}) {
  const cpus = os.cpus() || [];
  const load = os.loadavg();
  const mem = readHostMemoryDetails();
  const sample = collectSample();

  const [disks, processes, pm2List, publicIp] = await Promise.all([
    listMountedDisks(),
    listTopVpsProcesses(processLimit),
    listPm2Processes(),
    includePublicIp ? fetchPublicIpSafe() : Promise.resolve(null),
  ]);

  return {
    host: {
      hostname: os.hostname(),
      distro: readLinuxDistroName(),
      platform: os.platform(),
      kernel: os.release(),
      arch: os.arch(),
      uptimeSec: Math.floor(os.uptime()),
      nodeVersion: process.version,
      botPid: process.pid,
      botUptimeSec: Math.floor(process.uptime()),
    },
    cpu: {
      model: cpus[0]?.model ? String(cpus[0].model).trim() : 'Virtual CPU',
      cores: cpus.length || 1,
      speedMhz: cpus[0]?.speed || 0,
      load1: Number((load[0] || 0).toFixed(2)),
      load5: Number((load[1] || 0).toFixed(2)),
      load15: Number((load[2] || 0).toFixed(2)),
      hostPct: sample.cpu.hostLoadPct,
      botPct: sample.cpu.processPct,
    },
    memory: {
      ...mem,
      botRssMb: sample.memory.rssMb,
      botHeapUsedMb: sample.memory.heapUsedMb,
    },
    network: {
      interfaces: getNetworkInterfacesList(),
      publicIp,
    },
    disks,
    processes,
    pm2: pm2List,
    terminal: getSessionState(sessionKey),
  };
}

module.exports = {
  getSessionState,
  resetSessionState,
  abortSessionCommand,
  executeVpsCommand,
  killVpsProcess,
  getVpsSystemSnapshot,
  listTopVpsProcesses,
  listMountedDisks,
  listPm2Processes,
};
