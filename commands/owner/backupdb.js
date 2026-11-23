const config = require('../../config');
const { createBackup, listBackups } = require('../../lib/backup');
const { formatSuccess, formatError, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'backupdb',
  alias: ['dbbackup'],
  category: 'owner',
  description: 'Buat cadangan (backup) database SQLite secara manual ke folder backups/',
  cooldown: 10,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid } = ctx;
    try {
      const result = await createBackup('manual', senderJid);
      const backups = listBackups();
      const sizeKb = (result.sizeBytes / 1024).toFixed(1);

      await ctx.reply(
        formatSuccess('Backup Database Berhasil', [
          `File   : ${keep(result.fileName)}`,
          `Ukuran : ${keep(`${sizeKb} KB`)}`,
          `Arsip  : ${backups.length}/${config.backup.keepLast} backup terakhir tersimpan rapi ♡`,
        ])
      );
    } catch (err) {
      logger.error('CMD:BACKUPDB', 'Gagal menjalankan backup manual', err);
      await ctx.reply(
        formatError('Backup Database Gagal', [
          'Maaf kak, terjadi kendala saat mencadangkan database.',
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
