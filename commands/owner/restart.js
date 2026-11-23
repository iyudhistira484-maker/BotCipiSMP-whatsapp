const config = require('../../config');
const {
  isPteroConfigured,
  sendPowerSignal,
  sendMinecraftBroadcast,
} = require('../../lib/ptero');
const { registerPendingConfirmation } = require('../../lib/broadcast');
const { sendButtons } = require('../../lib/buttons');
const { addAuditLog } = require('../../lib/database');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'restart',
  alias: ['mcrestart', 'rebootmc'],
  category: 'owner',
  description: 'Restart server Minecraft melalui Pterodactyl (wajib konfirmasi 30 detik)',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid } = ctx;
    const p = config.prefix;

    if (!isPteroConfigured() && !config.dryRun) {
      await ctx.reply(
        formatError('Pterodactyl Belum Diatur', [
          'Isi PTERO_PANEL_URL, PTERO_CLIENT_API_KEY, dan PTERO_SERVER_ID di file .env terlebih dahulu ya ♡',
        ])
      );
      return;
    }

    registerPendingConfirmation(senderJid, {
      kind: 'ptero_restart',
      label: `Restart Server ${config.minecraft.host}`,
      expiresInMs: 30000,
      onConfirm: async (confirmCtx) => {
        try {
          await sendMinecraftBroadcast(
            'Server sedang melakukan restart terjadwal, silakan masuk kembali dalam 1-2 menit ya!',
            '✿ Sistem'
          ).catch(() => {});

          const pwr = await sendPowerSignal('restart');
          addAuditLog({
            level: 'warn',
            category: 'ptero_power',
            actorJid: confirmCtx.senderJid,
            target: config.pterodactyl.serverId || 'server',
            action: 'restart',
            details: { dryRun: pwr.dryRun },
          });

          await confirmCtx.reply(
            formatSuccess('Sinyal Restart Dikirim!', [
              pwr.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
              `Server ${keep(config.minecraft.host)} sedang memulai ulang di Panel Pterodactyl 🔄`,
              'Notifikasi otomatis akan dikirim saat server kembali menyala ♡',
            ].filter(Boolean))
          );
        } catch (err) {
          logger.error('CMD:RESTART', 'Gagal me-restart server via Pterodactyl', err);
          await confirmCtx.reply(
            formatError('Gagal Restart Server', [`Detail: ${keep(err.message)}`])
          );
        }
      },
    });

    const warnBox = renderBox(
      '❖ ᴋᴏɴꜰɪʀᴍᴀsɪ ʀᴇsᴛᴀʀᴛ sᴇʀᴠᴇʀ',
      [
        config.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
        `✦ Target     : ${keep(config.minecraft.host)}`,
        '✦ Tindakan   : RESTART Server Minecraft',
        '✦ Batas Waktu: 30 detik',
        '',
        `◦ Ketik ${mono(`${p}ya`)} untuk me-restart atau ${mono(`${p}batal`)} untuk membatalkan ♡`,
      ].filter(Boolean),
      { footer: config.footer }
    );

    await sendButtons(sock, chatJid, {
      title: '🔄 Restart Server Minecraft?',
      text: warnBox,
      footer: config.footer,
      ownerJid: senderJid,
      oneTime: true,
      ttlMs: 30000,
      quoted: msg,
      buttons: [
        { command: `${p}ya`, text: '✅ Ya, Restart', oneTime: true },
        { command: `${p}batal`, text: '❌ Batal', oneTime: true },
      ],
    });
  },
};
