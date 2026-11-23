const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../config');
const { getDb, addAuditLog } = require('./database');
const { logger, getWibParts } = require('./logger');
const { pruneOldDailyLimits } = require('./limits');

fs.mkdirSync(config.paths.backupsDir, { recursive: true });

let scheduledTask = null;
let midnightCleanupTask = null;

/**
 * Ambil daftar file backup database terurut dari yang terbaru ke terlama
 * @returns {{ fileName: string, filePath: string, mtimeMs: number, sizeBytes: number }[]}
 */
function listBackups() {
  if (!fs.existsSync(config.paths.backupsDir)) return [];
  return fs
    .readdirSync(config.paths.backupsDir)
    .filter((f) => f.startsWith('cipismp-backup-') && f.endsWith('.db'))
    .map((fileName) => {
      const filePath = path.join(config.paths.backupsDir, fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        filePath,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Rotasi folder backups/ agar hanya menyimpan N backup terakhir (default 7)
 * @param {number} [keepLast]
 * @returns {string[]} daftar nama file lama yang dihapus
 */
function rotateBackups(keepLast = config.backup.keepLast || 7) {
  const backups = listBackups();
  if (backups.length <= keepLast) return [];

  const toDelete = backups.slice(keepLast);
  const removed = [];
  for (const item of toDelete) {
    try {
      fs.unlinkSync(item.filePath);
      removed.push(item.fileName);
    } catch (err) {
      logger.warn('BACKUP', `Gagal menghapus backup lama ${item.fileName}`, err.message);
    }
  }
  return removed;
}

/**
 * Buat snapshot backup SQLite baru secara aman (online backup API)
 * @param {string} [reason='auto']
 * @param {string} [actorJid='system']
 */
async function createBackup(reason = 'auto', actorJid = 'system') {
  fs.mkdirSync(config.paths.backupsDir, { recursive: true });
  const wib = getWibParts();
  const stamp = `${wib.year}${wib.month}${wib.day}-${wib.hour}${wib.minute}${wib.second}-${String(
    Date.now() % 1000
  ).padStart(3, '0')}`;
  const safeReason = String(reason || 'auto').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'auto';
  const fileName = `cipismp-backup-${stamp}-${safeReason}.db`;
  const destPath = path.join(config.paths.backupsDir, fileName);

  const db = getDb();
  await db.backupTo(destPath);

  const stat = fs.statSync(destPath);
  const prunedFiles = rotateBackups(config.backup.keepLast || 7);
  const currentBackups = listBackups();

  addAuditLog({
    level: 'info',
    category: 'backup',
    actorJid,
    target: fileName,
    action: 'create_backup',
    details: {
      reason: safeReason,
      sizeBytes: stat.size,
      keptCount: currentBackups.length,
      prunedCount: prunedFiles.length,
    },
  });

  logger.info(
    'BACKUP',
    `Backup database berhasil dibuat: ${fileName} (${(stat.size / 1024).toFixed(1)} KB, tersimpan: ${currentBackups.length}/${config.backup.keepLast})`
  );

  return {
    fileName,
    filePath: destPath,
    sizeBytes: stat.size,
    totalKept: currentBackups.length,
    prunedFiles,
  };
}

/**
 * Aktifkan penjadwalan backup otomatis setiap 24 jam (WIB) & pembersihan tengah malam WIB
 */
async function startBackupScheduler() {
  if (scheduledTask) return;

  // Cek saat startup: bila belum ada backup dalam 24 jam terakhir, buat 1 backup awal
  try {
    const existing = listBackups();
    const newestAgeMs = existing.length > 0 ? Date.now() - existing[0].mtimeMs : Infinity;
    if (newestAgeMs >= 24 * 60 * 60 * 1000) {
      await createBackup('startup');
    }
  } catch (err) {
    logger.error('BACKUP', 'Gagal membuat backup awal saat startup', err);
  }

  // Cron 24 jam sekali pada pukul 00:05 WIB
  scheduledTask = cron.schedule(
    config.backup.cronSchedule || '5 0 * * *',
    async () => {
      try {
        await createBackup('daily');
      } catch (err) {
        logger.error('BACKUP', 'Backup terjadwal harian gagal dijalankan', err);
      }
    },
    { timezone: config.timezone || 'Asia/Jakarta' }
  );

  // Cron tengah malam 00:01 WIB untuk bersih-bersih data daily_limits lawas
  midnightCleanupTask = cron.schedule(
    '1 0 * * *',
    () => {
      try {
        const cleaned = pruneOldDailyLimits();
        if (cleaned > 0) {
          logger.info('LIMITS', `Reset harian WIB: membersihkan ${cleaned} baris limit lama`);
        }
      } catch (err) {
        logger.error('LIMITS', 'Gagal membersihkan histori daily_limits', err);
      }
    },
    { timezone: config.timezone || 'Asia/Jakarta' }
  );

  logger.info('BACKUP', `Penjadwal backup otomatis aktif (${config.backup.cronSchedule} WIB, simpan ${config.backup.keepLast} terakhir)`);
}

function stopBackupScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (midnightCleanupTask) {
    midnightCleanupTask.stop();
    midnightCleanupTask = null;
  }
}

module.exports = {
  listBackups,
  rotateBackups,
  createBackup,
  startBackupScheduler,
  stopBackupScheduler,
};
