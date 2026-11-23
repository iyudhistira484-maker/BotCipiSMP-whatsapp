const config = require('../../config');
const { addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'tutup',
  alias: ['closegrup', 'tutupgrup', 'grup', 'group'],
  category: 'group',
  description: 'Tutup obrolan grup (hanya Admin yang bisa mengirim pesan) atau .grup buka/tutup',
  cooldown: 5,
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, chatJid, senderJid, commandName, args, invalidateGroupCache } = ctx;
    const p = config.prefix;
    const sub = (args[0] || '').toLowerCase();

    let targetMode = 'announcement'; // default: tutup
    if (commandName === 'grup' || commandName === 'group') {
      if (sub === 'buka' || sub === 'open') {
        targetMode = 'not_announcement';
      } else if (sub === 'tutup' || sub === 'close') {
        targetMode = 'announcement';
      } else {
        await ctx.reply(
          formatError('Pilih Buka atau Tutup', [
            `Gunakan ${mono(`${p}grup buka`)} atau ${mono(`${p}grup tutup`)} (bisa juga langsung ${mono(`${p}buka`)} / ${mono(`${p}tutup`)}) ♡`,
          ])
        );
        return;
      }
    }

    try {
      await sock.groupSettingUpdate(chatJid, targetMode);
      invalidateGroupCache(chatJid);

      const isClosing = targetMode === 'announcement';
      addAuditLog({
        level: 'info',
        category: 'group',
        actorJid: senderJid,
        target: chatJid,
        action: isClosing ? 'close_group' : 'open_group',
      });

      await ctx.reply(
        formatSuccess(isClosing ? 'Grup Ditutup' : 'Grup Dibuka', [
          isClosing
            ? 'Grup telah dikunci sementara. Hanya Admin Grup yang bisa mengirim pesan ya ✿'
            : 'Obrolan grup sudah dibuka kembali untuk semua anggota ♡',
        ])
      );
    } catch (err) {
      logger.error('CMD:TUTUP', 'Gagal mengubah setelan grup', err);
      await ctx.reply(
        formatError('Gagal Mengubah Grup', [
          'Pastikan aku masih berstatus Admin Grup ya kak ♡',
        ])
      );
    }
  },
};
