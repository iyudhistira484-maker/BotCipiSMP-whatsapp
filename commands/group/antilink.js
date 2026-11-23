const config = require('../../config');
const { getDb, ensureGroup, addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError, renderBox, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'antilink',
  alias: ['antiurl', 'antilinkgrup'],
  category: 'group',
  description: 'Aktifkan/nonaktifkan proteksi tautan luar otomatis di grup',
  cooldown: 4,
  groupOnly: true,
  adminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, chatJid, senderJid, args, getCachedGroupMetadata } = ctx;
    const p = config.prefix;
    const sub = (args[0] || '').toLowerCase();
    const groupRow = ensureGroup(chatJid);

    if (!sub) {
      await ctx.reply(
        renderBox('ᴘʀᴏᴛᴇᴋsɪ ᴀɴᴛɪʟɪɴᴋ ɢʀᴜᴘ', [
          `✦ Status Saat Ini : ${groupRow.antilink ? 'Aktif ✅' : 'Nonaktif ❌'}`,
          `◦ ${mono(`${p}antilink on`)} — nyalakan sensor tautan luar`,
          `◦ ${mono(`${p}antilink off`)} — matikan sensor tautan luar`,
        ])
      );
      return;
    }

    if (sub !== 'on' && sub !== 'off') {
      await ctx.reply(
        formatError('Pilihan Tidak Valid', [
          `Ketik ${mono(`${p}antilink on`)} atau ${mono(`${p}antilink off`)} ya kak ♡`,
        ])
      );
      return;
    }

    const enable = sub === 'on' ? 1 : 0;
    getDb().run('UPDATE groups SET antilink = ?, updated_at = ? WHERE jid = ?', [
      enable,
      Date.now(),
      chatJid,
    ]);

    addAuditLog({
      level: 'info',
      category: 'group',
      actorJid: senderJid,
      target: chatJid,
      action: enable ? 'antilink_on' : 'antilink_off',
    });

    const meta = await getCachedGroupMetadata(chatJid);
    void sock;
    void meta;

    await ctx.reply(
      formatSuccess(enable ? 'Antilink Diaktifkan' : 'Antilink Dinonaktifkan', [
        enable
          ? 'Tautan grup WA/link asing dari member biasa akan diperingatkan & dihapus otomatis (pastikan bot menjadi Admin) ♡'
          : 'Proteksi antilink di grup ini telah dimatikan ✿',
      ])
    );
  },
};
