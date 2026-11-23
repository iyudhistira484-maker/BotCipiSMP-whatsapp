const config = require('../../config');
const {
  isPteroConfigured,
  getServerResources,
  sendPowerSignal,
} = require('../../lib/ptero');
const { addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'start',
  alias: ['mcstart', 'nyalakanserver'],
  category: 'owner',
  description: 'Nyalakan server Minecraft melalui Panel Pterodactyl',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    if (!isPteroConfigured() && !config.dryRun) {
      await ctx.reply(
        formatError('Pterodactyl Belum Diatur', [
          'Isi PTERO_PANEL_URL, PTERO_CLIENT_API_KEY, dan PTERO_SERVER_ID di file .env terlebih dahulu ya ♡',
        ])
      );
      return;
    }

    try {
      let currentState = 'unknown';
      if (!config.dryRun && isPteroConfigured()) {
        const resAttr = await getServerResources().catch(() => null);
        currentState = resAttr?.current_state || 'unknown';
        if (currentState === 'running') {
          await ctx.reply(
            formatSuccess('Server Sudah Menyala', [
              `Server ${keep(config.minecraft.host)} saat ini sudah dalam keadaan RUNNING ✅`,
            ])
          );
          return;
        }
      }

      const pwr = await sendPowerSignal('start');
      addAuditLog({
        category: 'ptero_power',
        actorJid: ctx.senderJid,
        target: config.pterodactyl.serverId || 'server',
        action: 'start',
        details: { prevState: currentState, dryRun: pwr.dryRun },
      });

      await ctx.reply(
        formatSuccess('Sinyal Start Dikirim!', [
          pwr.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
          `Perintah menyalakan server ${keep(config.minecraft.host)} berhasil dikirim ke Panel Pterodactyl 🚀`,
          'Notifikasi otomatis akan muncul begitu server selesai booting ♡',
        ].filter(Boolean))
      );
    } catch (err) {
      logger.error('CMD:START', 'Gagal mengirim sinyal start Pterodactyl', err);
      await ctx.reply(
        formatError('Gagal Menyalakan Server', [
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
