const config = require('../../config');
const {
  validateWhitelistedConsoleCommand,
  executeMinecraftCommand,
} = require('../../lib/ptero');
const { addAuditLog } = require('../../lib/database');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'console',
  alias: ['cmdmc', 'rcon', 'mccmd'],
  category: 'owner',
  description: 'Kirim perintah console Minecraft aman (dibatasi daftar putih / whitelist ketat)',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, text } = ctx;
    const p = config.prefix;

    if (!text) {
      const allowedExact = (config.minecraft.consoleWhitelist || [])
        .map((c) => mono(c))
        .join(', ');
      const allowedParam = ['say <pesan>', 'whitelist add <nama>', 'whitelist remove <nama>']
        .map((c) => mono(c))
        .join(', ');

      await ctx.reply(
        renderBox(
          '❖ ᴄᴏɴsᴏʟᴇ ᴍɪɴᴇᴄʀᴀꜰᴛ (ᴡʜɪᴛᴇʟɪsᴛ)',
          [
            `✦ Contoh Pakai : ${mono(`${p}console list`)} atau ${mono(`${p}console whitelist add .Steve_BE`)}`,
            '',
            `✦ Command Dasar: ${allowedExact}`,
            `✦ Berargumen   : ${allowedParam}`,
            '',
            '◦ Demi keamanan server, perintah sensitif (op/deop/execute/lp) diblokir dari WhatsApp ♡',
          ],
          { footer: config.footer }
        )
      );
      return;
    }

    const check = validateWhitelistedConsoleCommand(text);
    if (!check.allowed) {
      addAuditLog({
        level: 'warn',
        category: 'ptero_console',
        actorJid: senderJid,
        target: config.minecraft.host,
        action: 'blocked_command',
        details: { attempted: text.slice(0, 120), reason: check.reason },
      });

      await ctx.reply(
        formatError('Perintah Ditolak Whitelist', [
          check.detail || 'Perintah tidak termasuk dalam daftar putih keamanan.',
          `Ketik ${mono(`${p}console`)} tanpa argumen untuk melihat daftar perintah yang diizinkan ♡`,
        ])
      );
      return;
    }

    const res = await executeMinecraftCommand(check.cleanCommand, {
      preferRconForOutput: true,
    });

    addAuditLog({
      category: 'ptero_console',
      actorJid: senderJid,
      target: config.minecraft.host,
      action: res.ok ? 'executed' : 'failed',
      details: {
        command: check.cleanCommand,
        via: res.via,
        dryRun: Boolean(res.dryRun),
      },
    });

    if (!res.ok) {
      await ctx.reply(
        formatError('Gagal Mengirim Perintah', [
          `Detail: ${keep(res.error || 'Tidak terhubung ke Pterodactyl maupun RCON')}`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatSuccess('Perintah Console Terkirim', [
        res.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
        `✦ Command : ${mono(check.cleanCommand)}`,
        `✦ Jalur   : ${keep(res.via)}`,
        res.response
          ? `✦ Output  : ${keep(res.response.slice(0, 500))}`
          : '◦ Output dikirim ke log console panel server ♡',
      ].filter(Boolean))
    );
  },
};
