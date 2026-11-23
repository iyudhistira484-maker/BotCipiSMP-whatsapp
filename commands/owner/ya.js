const { consumePendingConfirmation } = require('../../lib/broadcast');
const { formatError } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'ya',
  alias: ['confirm', 'konfirmasi'],
  category: 'owner',
  description: 'Konfirmasi eksekusi aksi sensitif Owner (broadcast / kontrol server)',
  cooldown: 1,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const session = consumePendingConfirmation(ctx.senderJid);
    if (!session) {
      await ctx.reply(
        formatError('Tidak Ada Konfirmasi Aktif', [
          'Tidak ada aksi yang sedang menunggu konfirmasi (atau waktu 30 detik sudah habis) ♡',
        ])
      );
      return;
    }

    try {
      await session.onConfirm(ctx);
    } catch (err) {
      logger.error('CONFIRM', `Eksekusi aksi terkonfirmasi (${session.kind}) gagal`, err);
      await ctx.reply(
        formatError('Eksekusi Gagal', [
          'Maaf kak, terjadi kesalahan saat menjalankan aksi yang dikonfirmasi ♡',
        ])
      );
    }
  },
};
