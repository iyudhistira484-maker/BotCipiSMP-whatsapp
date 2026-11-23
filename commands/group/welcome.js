const config = require('../../config');
const { getDb, ensureGroup } = require('../../lib/database');
const { sendWelcomeOrLeaveCard } = require('../../lib/group-guard');
const { formatSuccess, formatError, renderBox, mono, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'welcome',
  alias: ['sambutan', 'setwelcome'],
  category: 'group',
  description: 'Atur sambutan member masuk/keluar grup bergambar (on/off/setjoin/setleave/test)',
  cooldown: 4,
  groupOnly: true,
  adminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, chatJid, senderJid, args, text, getCachedGroupMetadata } = ctx;
    const p = config.prefix;
    const sub = (args[0] || '').toLowerCase();
    const groupRow = ensureGroup(chatJid);
    const db = getDb();

    if (!sub) {
      const statusText = groupRow.welcome_enabled ? 'Aktif ✅' : 'Nonaktif ❌';
      await ctx.reply(
        renderBox('ᴘᴇɴɢᴀᴛᴜʀᴀɴ ᴡᴇʟᴄᴏᴍᴇ & ʟᴇᴀᴠᴇ', [
          `✦ Status Saat Ini : ${statusText}`,
          `◦ ${mono(`${p}welcome on`)} — aktifkan kartu sambutan`,
          `◦ ${mono(`${p}welcome off`)} — matikan kartu sambutan`,
          `◦ ${mono(`${p}welcome setjoin <teks>`)} — ubah pesan masuk`,
          `◦ ${mono(`${p}welcome setleave <teks>`)} — ubah pesan keluar`,
          `◦ ${mono(`${p}welcome test`)} — uji contoh kartu welcome`,
          '◦ Variabel: @user, @group, @count',
        ])
      );
      return;
    }

    if (sub === 'on' || sub === 'enable' || sub === '1') {
      db.run('UPDATE groups SET welcome_enabled = 1, updated_at = ? WHERE jid = ?', [
        Date.now(),
        chatJid,
      ]);
      await ctx.reply(
        formatSuccess('Welcome Grup Diaktifkan', [
          'Sambutan masuk & keluar bergambar sekarang aktif di grup ini ♡',
        ])
      );
      return;
    }

    if (sub === 'off' || sub === 'disable' || sub === '0') {
      db.run('UPDATE groups SET welcome_enabled = 0, updated_at = ? WHERE jid = ?', [
        Date.now(),
        chatJid,
      ]);
      await ctx.reply(
        formatSuccess('Welcome Grup Dinonaktifkan', [
          'Sambutan member masuk/keluar berhasil dimatikan untuk grup ini ✿',
        ])
      );
      return;
    }

    if (sub === 'setjoin') {
      const customMsg = text.slice(sub.length).trim();
      if (!customMsg || customMsg.length < 4) {
        await ctx.reply(
          formatError('Teks Belum Diisi', [
            `Contoh: ${mono(`${p}welcome setjoin Halo @user, selamat datang di @group ♡`)}`,
          ])
        );
        return;
      }
      db.run('UPDATE groups SET welcome_text = ?, updated_at = ? WHERE jid = ?', [
        customMsg.slice(0, 300),
        Date.now(),
        chatJid,
      ]);
      await ctx.reply(
        formatSuccess('Pesan Welcome Diperbarui', [
          `Teks baru: ${keep(customMsg.slice(0, 300))}`,
        ])
      );
      return;
    }

    if (sub === 'setleave') {
      const customMsg = text.slice(sub.length).trim();
      if (!customMsg || customMsg.length < 4) {
        await ctx.reply(
          formatError('Teks Belum Diisi', [
            `Contoh: ${mono(`${p}welcome setleave Sampai jumpa @user, hati-hati di jalan ✿`)}`,
          ])
        );
        return;
      }
      db.run('UPDATE groups SET leave_text = ?, updated_at = ? WHERE jid = ?', [
        customMsg.slice(0, 300),
        Date.now(),
        chatJid,
      ]);
      await ctx.reply(
        formatSuccess('Pesan Leave Diperbarui', [
          `Teks baru: ${keep(customMsg.slice(0, 300))}`,
        ])
      );
      return;
    }

    if (sub === 'test' || sub === 'tes') {
      const meta = await getCachedGroupMetadata(chatJid);
      await sendWelcomeOrLeaveCard(sock, {
        groupJid: chatJid,
        participantJid: senderJid,
        mode: 'welcome',
        groupMeta: meta,
      });
      return;
    }

    await ctx.reply(
      formatError('Argumen Tidak Dikenal', [
        `Gunakan ${mono(`${p}welcome on`)}, ${mono(`${p}welcome off`)}, ${mono(`${p}welcome setjoin`)}, atau ${mono(`${p}welcome test`)} ya ♡`,
      ])
    );
  },
};
