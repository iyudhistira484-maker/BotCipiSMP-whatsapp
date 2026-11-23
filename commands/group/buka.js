const { addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'buka',
  alias: ['opengrup', 'bukagrup'],
  category: 'group',
  description: 'Buka obrolan grup agar semua anggota bisa mengirim pesan',
  cooldown: 5,
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, chatJid, senderJid, invalidateGroupCache } = ctx;
    try {
      await sock.groupSettingUpdate(chatJid, 'not_announcement');
      invalidateGroupCache(chatJid);

      addAuditLog({
        level: 'info',
        category: 'group',
        actorJid: senderJid,
        target: chatJid,
        action: 'open_group',
      });

      await ctx.reply(
        formatSuccess('Grup Dibuka', [
          'Obrolan grup sudah dibuka! Semua anggota sekarang bisa mengobrol kembali ♡',
        ])
      );
    } catch (err) {
      logger.error('CMD:BUKA', 'Gagal membuka grup', err);
      await ctx.reply(
        formatError('Gagal Membuka Grup', [
          'Pastikan aku masih berstatus Admin di grup ini ya kak ♡',
        ])
      );
    }
  },
};
