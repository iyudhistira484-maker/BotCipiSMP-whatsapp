const config = require('../../config');
const { isOwner, addAuditLog, normalizeUserJid } = require('../../lib/database');
const { triggerGracefulBotRestart } = require('../../lib/owner-manager');
const {
  formatSuccess,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'restartbot',
  alias: ['rebootbot', 'reload', 'reloadcmd'],
  category: 'owner',
  description: 'Muat ulang (hot-reload) seluruh command atau restart penuh proses Node.js bot',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, commandName, args, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const sub = String(args[0] || '').toLowerCase().trim();
    const isReloadOnly =
      commandName === 'reload' ||
      commandName === 'reloadcmd' ||
      sub === 'reload' ||
      sub === 'cmd';

    if (isReloadOnly) {
      const { loadCommands, commands, aliases } = require('../../index');
      loadCommands();

      addAuditLog({
        level: 'info',
        category: 'owner_admin',
        actorJid: normalizeUserJid(senderJid),
        target: 'commands',
        action: 'hot_reload_commands',
        details: { commandsCount: commands.size, aliasesCount: aliases.size },
      });

      return reply(
        formatSuccess('Hot-Reload Command Berhasil! ♻️', [
          `✦ Command Utama : ${commands.size} Command`,
          `✦ Total Alias   : ${aliases.size} Trigger`,
          '◦ Seluruh file command diperbarui tanpa memutus koneksi WhatsApp! ♡',
        ])
      );
    }

    const res = await triggerGracefulBotRestart({ actorJid: senderJid });
    const simNote = res.simulated
      ? '🧪 [DRY-RUN] Simulasi restart berhasil (proses tidak dimatikan pada mode uji).'
      : '♻️ Proses Node.js sedang dimuat ulang otomatis oleh PM2 / Panel dalam ~2 detik...';

    return reply(
      formatSuccess('Restart Proses Bot Dijadwalkan 🌸', [
        `✦ Backup DB Pra-Restart : ${keep(res.backupFile || 'Tersimpan')}`,
        `✦ Status                : ${simNote}`,
        `◦ Tips: Gunakan ${mono(`${prefix}reload`)} bila hanya ingin memuat ulang kode command tanpa restart!`,
      ])
    );
  },
};
