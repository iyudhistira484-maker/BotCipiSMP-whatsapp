const { cancelPendingConfirmation } = require('../../lib/broadcast');
const { formatSuccess, formatError, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'batal',
  alias: ['cancel', 'batalkan'],
  category: 'owner',
  description: 'Batalkan aksi Owner yang sedang menunggu konfirmasi',
  cooldown: 1,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const cancelled = cancelPendingConfirmation(ctx.senderJid);
    if (!cancelled) {
      await ctx.reply(
        formatError('Tidak Ada Aksi Tertunda', [
          'Saat ini tidak ada konfirmasi aktif yang perlu dibatalkan ♡',
        ])
      );
      return;
    }

    await ctx.reply(
      formatSuccess('Berhasil Dibatalkan', [
        `Aksi "${keep(cancelled.label)}" telah dibatalkan dengan aman ✿`,
      ])
    );
  },
};
