const config = require('../../config');
const { isOwner } = require('../../lib/database');
const { executeControlledEval } = require('../../lib/owner-manager');
const {
  renderBox,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'eval',
  alias: ['ev', 'jsdiag'],
  category: 'owner',
  description: 'Eksekusi diagnostik JS terkontrol di dalam sandbox VM terisolasi (Khusus Owner)',
  cooldown: 2,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, chatJid, text, commands, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    if (!config.enableOwnerEval) {
      return reply(
        formatWarning('Fitur .eval Dinonaktifkan demi Keamanan 🔒', [
          `✦ Secara bawaan, ${mono(`${prefix}eval`)} dimatikan di lingkungan produksi.`,
          `✦ Untuk mengaktifkan saat debugging, atur ${mono('ENABLE_OWNER_EVAL=true')} di file ${mono('.env')} lalu restart bot.`,
        ])
      );
    }

    if (!text) {
      return reply(
        formatWarning('Masukkan Ekspresi Diagnostik', [
          `✦ Objek aman yang tersedia di sandbox: ${mono('stats()')}, ${mono('wib()')}, ${mono('config')}, ${mono('db.get(...)')}, ${mono('db.all(...)')}`,
          `✦ Contoh 1: ${mono(`${prefix}eval stats()`)}`,
          `✦ Contoh 2: ${mono(`${prefix}eval db.get('SELECT COUNT(*) AS total FROM users')`)}`,
        ])
      );
    }

    const res = await executeControlledEval({
      actorJid: senderJid,
      code: text,
      meta: {
        chatJid,
        commandsCount: commands ? commands.size : 0,
      },
    });

    if (!res.ok) {
      if (res.reason === 'blocked_pattern') {
        return reply(
          formatError('Pola Ditolak Sandbox Keamanan 🛡️', [
            '✦ Demi keamanan server, akses shell OS, modifikasi file, prototype escape, dan process.env mentah diblokir di sandbox.',
          ])
        );
      }
      return reply(
        formatError(`Eval Error (${res.elapsedMs || 0} ms)`, [
          keep(res.error || 'Terjadi kesalahan eksekusi'),
        ])
      );
    }

    return reply(
      renderBox(
        `🧪 ʜᴀsɪʟ sᴀɴᴅʙᴏx ᴇᴠᴀʟ (${res.elapsedMs} ᴍs)`,
        [keep(res.output)],
        { footer: config.footer }
      )
    );
  },
};
