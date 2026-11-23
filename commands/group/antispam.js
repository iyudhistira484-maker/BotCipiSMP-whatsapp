const config = require('../../config');
const { getDb, ensureGroup, addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError, renderBox, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'antispam',
  alias: ['antiflood'],
  category: 'group',
  description: 'Aktifkan/nonaktifkan pencegah banjir pesan beruntun (anti-spam) di grup',
  cooldown: 4,
  groupOnly: true,
  adminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { chatJid, senderJid, args } = ctx;
    const p = config.prefix;
    const sub = (args[0] || '').toLowerCase();
    const groupRow = ensureGroup(chatJid);

    if (!sub) {
      await ctx.reply(
        renderBox('ᴘʀᴏᴛᴇᴋsɪ ᴀɴᴛɪ-sᴘᴀᴍ ɢʀᴜᴘ', [
          `✦ Status Saat Ini : ${groupRow.antispam ? 'Aktif ✅' : 'Nonaktif ❌'}`,
          `◦ ${mono(`${p}antispam on`)} — nyalakan pelindung anti-spam`,
          `◦ ${mono(`${p}antispam off`)} — matikan pelindung anti-spam`,
        ])
      );
      return;
    }

    if (sub !== 'on' && sub !== 'off') {
      await ctx.reply(
        formatError('Pilihan Tidak Valid', [
          `Ketik ${mono(`${p}antispam on`)} atau ${mono(`${p}antispam off`)} ya kak ♡`,
        ])
      );
      return;
    }

    const enable = sub === 'on' ? 1 : 0;
    getDb().run('UPDATE groups SET antispam = ?, updated_at = ? WHERE jid = ?', [
      enable,
      Date.now(),
      chatJid,
    ]);

    addAuditLog({
      level: 'info',
      category: 'group',
      actorJid: senderJid,
      target: chatJid,
      action: enable ? 'antispam_on' : 'antispam_off',
    });

    await ctx.reply(
      formatSuccess(enable ? 'Anti-Spam Diaktifkan' : 'Anti-Spam Dinonaktifkan', [
        enable
          ? 'Pesan beruntun berlebihan / duplikat dari member non-admin akan ditahan otomatis ♡'
          : 'Proteksi anti-spam di grup ini telah dimatikan ✿',
      ])
    );
  },
};
