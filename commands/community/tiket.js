const config = require('../../config');
const { isOwner } = require('../../lib/database');
const {
  listTicketsForUser,
  replySupportTicket,
  closeSupportTicket,
} = require('../../lib/scheduler');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'tiket',
  alias: ['ticket', 'myticket', 'cektiket'],
  category: 'community',
  description: 'Cek status tiket laporanmu, balas pesan Admin Discord, atau tutup tiket',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, args, text } = ctx;
    const senderIsOwner = Boolean(ctx.isOwner || isOwner(senderJid));
    const p = config.prefix;
    const sub = (args[0] || 'list').toLowerCase();

    // 1. Balas tiket (.tiket balas TKT-XXXX <pesan>)
    if (sub === 'balas' || sub === 'reply') {
      const tNo = args[1] || '';
      const replyBody = text
        .replace(/^(?:balas|reply)\s+\S+\s*/i, '')
        .trim();

      if (!tNo || !replyBody) {
        await ctx.reply(
          formatError('Format Balas Tiket', [
            `Contoh: ${mono(`${p}tiket balas TKT-1234AB Berikut koordinat tambahannya kak`)}`,
          ])
        );
        return;
      }

      const res = await replySupportTicket({
        actorRawJid: senderJid,
        actorName: pushName,
        isStaff: senderIsOwner,
        ticketNoInput: tNo,
        replyText: replyBody,
      });

      if (!res.ok) {
        const msgMap = {
          not_found: 'Nomor tiket tidak ditemukan ♡',
          closed: 'Tiket tersebut sudah ditutup sebelumnya ♡',
          forbidden: 'Kamu hanya dapat membalas tiket milikmu sendiri ♡',
        };
        await ctx.reply(formatError('Gagal Membalas Tiket', [msgMap[res.reason] || 'Gagal.']));
        return;
      }

      await ctx.reply(
        formatSuccess(`Balasan #${keep(res.ticketNo)} Terkirim`, [
          senderIsOwner
            ? 'Balasan Admin telah diteruskan ke WhatsApp pelapor & Thread Discord ✅'
            : 'Pesan tambahanmu telah diteruskan ke Thread Admin Discord ✅',
        ])
      );
      return;
    }

    // 2. Tutup tiket (.tiket tutup TKT-XXXX [alasan])
    if (sub === 'tutup' || sub === 'close') {
      const tNo = args[1] || '';
      const reason =
        text.replace(/^(?:tutup|close)\s+\S+\s*/i, '').trim() ||
        (senderIsOwner ? 'Diselesaikan oleh Owner/Admin' : 'Ditutup oleh pelapor sendiri');

      if (!tNo) {
        await ctx.reply(
          formatError('Nomor Tiket Kosong', [`Contoh: ${mono(`${p}tiket tutup TKT-1234AB`)}`])
        );
        return;
      }

      const res = await closeSupportTicket({
        actorRawJid: senderJid,
        actorName: pushName,
        isStaff: senderIsOwner,
        ticketNoInput: tNo,
        resolutionText: reason,
      });

      if (!res.ok) {
        const msgMap = {
          not_found: 'Nomor tiket tidak ditemukan ♡',
          already_closed: 'Tiket tersebut sudah berstatus selesai/ditutup ♡',
          forbidden: 'Kamu hanya dapat menutup tiket milikmu sendiri ♡',
        };
        await ctx.reply(formatError('Gagal Menutup Tiket', [msgMap[res.reason] || 'Gagal.']));
        return;
      }

      await ctx.reply(
        formatSuccess(`Tiket #${keep(res.ticketNo)} Ditutup`, [
          `✦ Catatan: ${keep(res.resolution)}`,
        ])
      );
      return;
    }

    // 3. Daftar tiket (.tiket atau .tiket admin untuk Owner)
    const showAllOpen = senderIsOwner && (sub === 'admin' || sub === 'all');
    const rows = listTicketsForUser(senderJid, { includeAllForAdmin: showAllOpen });

    if (rows.length === 0) {
      await ctx.reply(
        renderBox(
          '🎫 ᴅᴀꜰᴛᴀʀ ᴛɪᴋᴇᴛ ʟᴀᴘᴏʀᴀɴ',
          [
            showAllOpen
              ? '✦ Tidak ada antrean tiket terbuka saat ini 🎉'
              : `✦ Kamu belum memiliki riwayat tiket laporan ♡`,
            `◦ Buat laporan baru kapan saja dengan ${mono(`${p}lapor <pesan>`)}!`,
          ],
          { footer: config.footer }
        )
      );
      return;
    }

    const lines = [];
    for (const r of rows.slice(0, 8)) {
      const stIcon = r.status === 'open' ? '🟢 OPEN' : '🔒 CLOSED';
      lines.push(
        `✦ *${keep(r.ticket_no)}* [${keep(r.category.toUpperCase())}] — ${stIcon}`
      );
      if (showAllOpen) {
        lines.push(`  Pelapor : ${keep(r.user_name)}`);
      }
      lines.push(`  Subjek  : ${keep(r.subject)}`);
      if (r.assigned_to) {
        lines.push(`  Ditangani: ${keep(r.assigned_to)}`);
      }
    }

    lines.push('');
    lines.push(`◦ Balas: ${mono(`${p}tiket balas <kode> <pesan>`)}`);
    lines.push(`◦ Tutup: ${mono(`${p}tiket tutup <kode>`)}`);
    if (senderIsOwner && !showAllOpen) {
      lines.push(`◦ Antrean Admin: ${mono(`${p}tiket admin`)}`);
    }

    await ctx.reply(
      renderBox(
        showAllOpen ? '🎫 ᴀɴᴛʀᴇᴀɴ ᴛɪᴋᴇᴛ ᴛᴇʀʙᴜᴋᴀ (ᴀᴅᴍɪɴ)' : '🎫 ʀɪᴡᴀʏᴀᴛ ᴛɪᴋᴇᴛ ᴋᴀᴍᴜ',
        lines,
        { footer: config.footer }
      )
    );
  },
};
