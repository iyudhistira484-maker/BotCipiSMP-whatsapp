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
  name: 'stop',
  alias: ['mcstop', 'matikanserver'],
  category: 'owner',
  description: 'Matikan server Minecraft melalui Pterodactyl (wajib konfirmasi 30 detik)',
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
      kind: 'ptero_stop',
      label: `Matikan Server ${config.minecraft.host}`,
      expiresInMs: 30000,
      onConfirm: async (confirmCtx) => {
        try {
          await sendMinecraftBroadcast(
            'Server akan dimatikan sekarang oleh Owner. Sampai jumpa sebentar lagi!',
            '✿ Sistem'
          ).catch(() => {});

          const pwr = await sendPowerSignal('stop');
          addAuditLog({
            level: 'warn',
            category: 'ptero_power',
            actorJid: confirmCtx.senderJid,
            target: config.pterodactyl.serverId || 'server',
            action: 'stop',
            details: { dryRun: pwr.dryRun },
          });

          await confirmCtx.reply(
            formatSuccess('Sinyal Stop Dikirim', [
              pwr.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
              `Perintah mematikan server ${keep(config.minecraft.host)} telah dikirim ke Panel Pterodactyl 🛑`,
            ].filter(Boolean))
          );
        } catch (err) {
          logger.error('CMD:STOP', 'Gagal mematikan server via Pterodactyl', err);
          await confirmCtx.reply(
            formatError('Gagal Mematikan Server', [`Detail: ${keep(err.message)}`])
          );
        }
      },
    });

    const warnBox = renderBox(
      '❖ ᴋᴏɴꜰɪʀᴍᴀsɪ ᴍᴀᴛɪᴋᴀɴ sᴇʀᴠᴇʀ',
      [
        config.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
        `✦ Target     : ${keep(config.minecraft.host)}`,
        '✦ Tindakan   : STOP (Matikan Server Minecraft)',
        '✦ Batas Waktu: 30 detik',
        '',
        `◦ Ketik ${mono(`${p}ya`)} untuk melanjutkan atau ${mono(`${p}batal`)} untuk membatalkan ♡`,
      ].filter(Boolean),
      { footer: config.footer }
    );

    await sendButtons(sock, chatJid, {
      title: '⚠️ Matikan Server Minecraft?',
      text: warnBox,
      footer: config.footer,
      ownerJid: senderJid,
      oneTime: true,
      ttlMs: 30000,
      quoted: msg,
      buttons: [
        { command: `${p}ya`, text: '✅ Ya, Matikan', oneTime: true },
        { command: `${p}batal`, text: '❌ Batal', oneTime: true },
      ],
    });
  },
};
