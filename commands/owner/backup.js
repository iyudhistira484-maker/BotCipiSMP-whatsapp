const config = require('../../config');
const {
  isPteroConfigured,
  listPteroBackups,
  createPteroServerBackup,
} = require('../../lib/ptero');
const { addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError, keep, mono } = require('../../lib/smallcaps');
const { getWibParts, logger } = require('../../lib/logger');

module.exports = {
  name: 'backup',
  alias: ['mcbackup', 'serverbackup'],
  category: 'owner',
  description: 'Buat cadangan (backup) file server Minecraft di Panel Pterodactyl',
  cooldown: 15,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, text } = ctx;
    const p = config.prefix;

    if (!isPteroConfigured() && !config.dryRun) {
      await ctx.reply(
        formatError('Pterodactyl Belum Diatur', [
          'Isi PTERO_PANEL_URL, PTERO_CLIENT_API_KEY, dan PTERO_SERVER_ID di .env terlebih dahulu ♡',
          `Catatan: Untuk mem-backup database SQLite bot WA, gunakan ${mono(`${p}backupdb`)}.`,
        ])
      );
      return;
    }

    try {
      const parts = getWibParts();
      const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
      const customName = text ? text.trim() : `cipismp-wa-${stamp}`;

      const existing = !config.dryRun
        ? await listPteroBackups().catch(() => [])
        : [];

      const res = await createPteroServerBackup(customName);
      const bkp = res.backup || {};

      addAuditLog({
        category: 'ptero_backup',
        actorJid: senderJid,
        target: config.pterodactyl.serverId || 'server',
        action: 'create_backup',
        details: {
          name: bkp.name || customName,
          uuid: bkp.uuid || '',
          dryRun: res.dryRun,
        },
      });

      await ctx.reply(
        formatSuccess('Backup Server Dimulai!', [
          res.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
          `✦ Nama Backup: ${keep(bkp.name || customName)}`,
          bkp.uuid ? `✦ UUID       : ${keep(bkp.uuid.slice(0, 8))}` : '',
          `✦ Total Arsip: ${existing.length + 1} backup di panel`,
          '◦ Proses kompresi berjalan di latar belakang Panel Pterodactyl ♡',
        ].filter(Boolean))
      );
    } catch (err) {
      logger.error('CMD:BACKUP', 'Gagal membuat backup Pterodactyl', err);
      await ctx.reply(
        formatError('Gagal Membuat Backup Server', [
          `Detail: ${keep(err.message)}`,
          'Pastikan slot kuota Backup di Panel Pterodactyl belum penuh ya kak ♡',
        ])
      );
    }
  },
};
