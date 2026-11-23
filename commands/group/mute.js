const config = require('../../config');
const { getDb, ensureGroup, addAuditLog } = require('../../lib/database');
const { formatSuccess, formatError, renderBox, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'mute',
  alias: ['banchat', 'unmute'],
  category: 'group',
  description: 'Bisukan respon bot untuk member biasa di grup (khusus Admin tetap aktif)',
  cooldown: 4,
  groupOnly: true,
  adminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { chatJid, senderJid, commandName, args } = ctx;
    const p = config.prefix;
    const groupRow = ensureGroup(chatJid);

    let sub = (args[0] || '').toLowerCase();
    if (commandName === 'unmute') {
      sub = 'off';
    }

    if (!sub) {
      await ctx.reply(
        renderBox('ᴍᴏᴅᴇ ᴍᴜᴛᴇ ʙᴏᴛ ɢʀᴜᴘ', [
          `✦ Status Saat Ini : ${groupRow.mute ? 'Dibisukan 🔇' : 'Aktif Normal 🔔'}`,
          `◦ ${mono(`${p}mute on`)} — bisukan bot untuk member biasa`,
          `◦ ${mono(`${p}mute off`)} — aktifkan kembali respon bot`,
        ])
      );
      return;
    }

    if (sub !== 'on' && sub !== 'off') {
      await ctx.reply(
        formatError('Pilihan Tidak Valid', [
          `Gunakan ${mono(`${p}mute on`)} atau ${mono(`${p}mute off`)} ya kak ♡`,
        ])
      );
      return;
    }

    const enable = sub === 'on' ? 1 : 0;
    getDb().run('UPDATE groups SET mute = ?, updated_at = ? WHERE jid = ?', [
      enable,
      Date.now(),
      chatJid,
    ]);

    addAuditLog({
      level: 'info',
      category: 'group',
      actorJid: senderJid,
      target: chatJid,
      action: enable ? 'mute_on' : 'mute_off',
    });

    await ctx.reply(
      formatSuccess(enable ? 'Grup Dibisukan (Mute)' : 'Mute Grup Dibuka', [
        enable
          ? 'Aku akan diam untuk member biasa di grup ini. Admin tetap bisa memakai command ya ♡'
          : 'Yeay! Aku siap merespon semua petualang di grup ini lagi ✿',
      ])
    );
  },
};
