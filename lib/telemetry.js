const fs = require('fs');
const os = require('os');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const config = require('../config');
const { subscribeConsoleLogs } = require('./logger');

const HISTORY_MAX = 60;
const SAMPLE_INTERVAL_MS = 1500;
const STORAGE_CACHE_TTL_MS = 10000;

const history = [];
const subscribers = new Set();
const cmdTimestamps = [];
let totalCommandsHandled = 0;

// Hook otomatis ke logger untuk menghitung throughput command per menit secara nyata
subscribeConsoleLogs((entry) => {
  if (entry && entry.level === 'cmd') {
    totalCommandsHandled += 1;
    cmdTimestamps.push(entry.epoch || Date.now());
  }
});

let loopHistogram = null;
try {
  loopHistogram = monitorEventLoopDelay({ resolution: 10 });
  loopHistogram.enable();
} catch {
  loopHistogram = null;
}

let prevCpuUsage = process.cpuUsage();
let prevHrTime = process.hrtime.bigint();
let sampleTimer = null;
let cachedStorage = null;
let cachedStorageAt = 0;

function sumDirectoryBytes(dirPath, maxFiles = 500) {
  try {
    if (!fs.existsSync(dirPath)) return { bytes: 0, files: 0 };
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let bytes = 0;
    let files = 0;
    for (const ent of entries) {
      if (ent.name === '.gitkeep') continue;
      if (files >= maxFiles) break;
      const full = path.join(dirPath, ent.name);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          bytes += st.size;
          files += 1;
        }
      } catch {
        // Abaikan file sementara yang sedang dihapus
      }
    }
    return { bytes, files };
  } catch {
    return { bytes: 0, files: 0 };
  }
}

function measureStorage(force = false) {
  const now = Date.now();
  if (!force && cachedStorage && now - cachedStorageAt < STORAGE_CACHE_TTL_MS) {
    return cachedStorage;
  }

  const activeDbFile = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : config.paths.databaseFile;
  const activeBackupsDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : config.paths.backupsDir;
  const activeSessionDir = process.env.SESSION_DIR
    ? path.resolve(process.env.SESSION_DIR)
    : config.paths.session;

  let dbPrimaryBytes = 0;
  let walBytes = 0;
  let shmBytes = 0;
  try {
    if (fs.existsSync(activeDbFile)) dbPrimaryBytes = fs.statSync(activeDbFile).size;
    if (fs.existsSync(`${activeDbFile}-wal`)) walBytes = fs.statSync(`${activeDbFile}-wal`).size;
    if (fs.existsSync(`${activeDbFile}-shm`)) shmBytes = fs.statSync(`${activeDbFile}-shm`).size;
  } catch {
    // Abaikan
  }
  const dbBytes = dbPrimaryBytes + walBytes + shmBytes;

  const backupsStat = sumDirectoryBytes(activeBackupsDir);
  const sessionStat = sumDirectoryBytes(activeSessionDir);
  const logsStat = sumDirectoryBytes(config.paths.logsDir);

  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  let diskUsedBytes = 0;
  let diskUsedPct = 0;

  try {
    if (typeof fs.statfsSync === 'function') {
      const sfs = fs.statfsSync(config.paths.root);
      const bsize = Number(sfs.bsize || 4096);
      diskTotalBytes = Number(sfs.blocks || 0) * bsize;
      diskFreeBytes = Number(sfs.bavail || sfs.bfree || 0) * bsize;
      diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
      diskUsedPct =
        diskTotalBytes > 0 ? Number(((diskUsedBytes / diskTotalBytes) * 100).toFixed(1)) : 0;
    }
  } catch {
    // Fallback aman bila statfs tidak tersedia di OS tertentu
  }

  cachedStorage = {
    dbPath: activeDbFile,
    dbBytes,
    dbPrimaryBytes,
    walBytes,
    shmBytes,
    backupsBytes: backupsStat.bytes,
    backupsCount: backupsStat.files,
    sessionBytes: sessionStat.bytes,
    sessionFiles: sessionStat.files,
    logsBytes: logsStat.bytes,
    appTotalBytes: dbBytes + backupsStat.bytes + sessionStat.bytes + logsStat.bytes,
    diskTotalBytes,
    diskFreeBytes,
    diskUsedBytes,
    diskUsedPct,
  };
  cachedStorageAt = now;
  return cachedStorage;
}

function collectSample() {
  const now = Date.now();
  const cpuCount = Math.max(1, os.cpus().length);

  // 1. CPU % proses Node.js (delta mikrodetik dibagi waktu riil)
  const currentHr = process.hrtime.bigint();
  const elapsedUs = Math.max(1000, Number(currentHr - prevHrTime) / 1000);
  const cpuDelta = process.cpuUsage(prevCpuUsage);
  prevCpuUsage = process.cpuUsage();
  prevHrTime = currentHr;

  const rawProcessCpuPct = ((cpuDelta.user + cpuDelta.system) / elapsedUs) * 100;
  const processCpuPct = Number(Math.min(100 * cpuCount, Math.max(0, rawProcessCpuPct)).toFixed(2));
  const normalizedProcessCpuPct = Number(
    Math.min(100, rawProcessCpuPct / cpuCount).toFixed(2)
  );

  const loadAvg = os.loadavg().map((v) => Number(v.toFixed(2)));
  const hostLoadPct = Number(Math.min(100, (loadAvg[0] / cpuCount) * 100).toFixed(1));

  // 2. Memori Proses & Host OS
  const mem = process.memoryUsage();
  const rssMb = Number((mem.rss / 1048576).toFixed(1));
  const heapUsedMb = Number((mem.heapUsed / 1048576).toFixed(1));
  const heapTotalMb = Number((mem.heapTotal / 1048576).toFixed(1));
  const externalMb = Number((mem.external / 1048576).toFixed(1));

  const osTotalMb = Math.round(os.totalmem() / 1048576);
  const osFreeMb = Math.round(os.freemem() / 1048576);
  const osUsedMb = Math.max(0, osTotalMb - osFreeMb);
  const osMemPct = osTotalMb > 0 ? Number(((osUsedMb / osTotalMb) * 100).toFixed(1)) : 0;

  // 3. Event-Loop Latency (ms)
  let loopMeanMs = 0;
  let loopP99Ms = 0;
  if (loopHistogram) {
    const meanNs = Number(loopHistogram.mean || 0);
    const p99Ns = Number(loopHistogram.percentile(99) || 0);
    if (Number.isFinite(meanNs) && meanNs > 0) {
      loopMeanMs = Number(Math.max(0, meanNs / 1e6 - 10).toFixed(2));
    }
    if (Number.isFinite(p99Ns) && p99Ns > 0) {
      loopP99Ms = Number(Math.max(0, p99Ns / 1e6 - 10).toFixed(2));
    }
    loopHistogram.reset();
  }

  // 4. Throughput Command 60 detik terakhir
  const cutoff = now - 60000;
  while (cmdTimestamps.length > 0 && cmdTimestamps[0] < cutoff) {
    cmdTimestamps.shift();
  }

  const storage = measureStorage(false);

  const sample = {
    epoch: now,
    cpu: {
      processPct: processCpuPct,
      normalizedPct: normalizedProcessCpuPct,
      hostLoadPct,
      loadAvg,
      cores: cpuCount,
    },
    memory: {
      rssMb,
      heapUsedMb,
      heapTotalMb,
      externalMb,
      osUsedMb,
      osTotalMb,
      osMemPct,
    },
    runtime: {
      eventLoopMs: loopMeanMs,
      eventLoopP99Ms: loopP99Ms,
      processUptimeSec: Math.floor(process.uptime()),
      osUptimeSec: Math.floor(os.uptime()),
      cmdPerMin: cmdTimestamps.length,
      totalCommands: totalCommandsHandled,
    },
    storage,
  };

  history.push(sample);
  if (history.length > HISTORY_MAX) {
    history.shift();
  }

  for (const fn of subscribers) {
    try {
      fn(sample);
    } catch {
      // Abaikan error listener
    }
  }

  return sample;
}

function startTelemetry() {
  if (sampleTimer) return;
  if (history.length === 0) {
    collectSample();
  }
  sampleTimer = setInterval(collectSample, SAMPLE_INTERVAL_MS);
  if (typeof sampleTimer.unref === 'function') {
    sampleTimer.unref();
  }
}

function stopTelemetry() {
  if (sampleTimer) {
    clearInterval(sampleTimer);
    sampleTimer = null;
  }
}

function getLatestSample() {
  return history.length > 0 ? history[history.length - 1] : collectSample();
}

function getTelemetryHistory() {
  if (history.length === 0) collectSample();
  return history.slice();
}

function subscribeTelemetry(listener) {
  if (typeof listener !== 'function') return () => {};
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function getStaticHostInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    nodeVersion: process.version,
    pid: process.pid,
    cpuModel: (cpus[0] && cpus[0].model ? cpus[0].model.trim() : 'Virtual CPU'),
    cpuCores: cpus.length,
    totalMemMb: Math.round(os.totalmem() / 1048576),
  };
}

module.exports = {
  startTelemetry,
  stopTelemetry,
  collectSample,
  getLatestSample,
  getTelemetryHistory,
  subscribeTelemetry,
  measureStorage,
  getStaticHostInfo,
};
