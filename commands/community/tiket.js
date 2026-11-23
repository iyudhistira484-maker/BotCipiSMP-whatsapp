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

function looksLikeTicketRef(token = '') {
  const clean = String(token || '').replace(/^#+/, '').trim();
  if (!clean) return false;
  if (/^\d{1,2}$/.test(clean)) return true;
  if (/^tkt-[a-z0-9]{4,10}$/i.test(clean)) return true;
  if (/^[0-9]{4}[a-f0-9]{2}$/i.test(clean)) return true;
  return false;
}

module.exports = {
  name: 'tiket',
  alias: ['ticket', 'myticket', 'cektiket'],
  category: 'community',
  description: 'Cek status tiket laporanmu, balas pesan Admin/Pelapor, atau tutup tiket',
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

    // 1. Balas tiket (.tiket balas TKT-XXXX <pesan> | .tiket balas 1 <pesan> | .tiket balas <pesan> jika hanya ada 1 tiket aktif)
    if (sub === 'balas' || sub === 'reply' || sub === 'jawab') {
      const afterSub = text.replace(/^(?:balas|reply|jawab)\s*/i, '').trim();
      const firstToken = (afterSub.split(/\s+/)[0] || '').trim();

      let tNo = '';
      let replyBody = '';

      if (looksLikeTicketRef(firstToken)) {
        tNo = firstToken;
        replyBody = afterSub.slice(firstToken.length).trim();
      } else if (afterSub) {
        // Jika user lupa menulis kode tiket & hanya punya 1 tiket open, pilih otomatis!
        const openList = listTicketsForUser(senderJid, { includeAllForAdmin: senderIsOwner }).filter(
          (r) => r.status === 'open'
        );
        if (openList.length === 1) {
          tNo = openList[0].ticket_no;
          replyBody = afterSub;
        }
      }

      if (!tNo || !replyBody) {
        const openList = listTicketsForUser(senderJid, { includeAllForAdmin: senderIsOwner }).filter(
          (r) => r.status === 'open'
        );
        const hintLines = [
          `Contoh kode  : ${mono(`${p}tiket balas TKT-1234AB Pesan balasanmu`)}`,
          `Contoh nomor : ${mono(`${p}tiket balas 1 Pesan balasanmu`)}`,
        ];
        if (openList.length > 0) {
          hintLines.push('');
          hintLines.push('❖ Tiket Aktif Saat Ini:');
          openList.slice(0, 4).forEach((r, idx) => {
            hintLines.push(`  [${idx + 1}] ${mono(r.ticket_no)} — ${keep(r.subject.slice(0, 40))}`);
          });
        } else {
          hintLines.push(`◦ Belum ada tiket terbuka. Buat laporan baru lewat ${mono(`${p}lapor <pesan>`)} ya ♡`);
        }
        await ctx.reply(formatError('Format Balas Tiket', hintLines));
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
        const openList = listTicketsForUser(senderJid, { includeAllForAdmin: senderIsOwner }).filter(
          (r) => r.status === 'open'
        );
        const msgMap = {
          not_found:
            openList.length > 0
              ? `Tiket ${mono(tNo)} tidak ditemukan. Coba ketik ${mono(`${p}tiket balas 1 <pesan>`)} atau cek ${mono(`${p}tiket`)} ♡`
              : `Tiket ${mono(tNo)} tidak ditemukan. Buat laporan baru dengan ${mono(`${p}lapor <pesan>`)} ya ♡`,
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
            : 'Pesan tambahanmu telah diteruskan ke Admin & Thread Discord ✅',
        ])
      );
      return;
    }

    // 2. Tutup tiket (.tiket tutup TKT-XXXX [alasan] atau .tiket tutup 1 [alasan])
    if (sub === 'tutup' || sub === 'close' || sub === 'selesai') {
      const tNo = args[1] || '';
      const reason =
        text.replace(/^(?:tutup|close|selesai)\s+\S+\s*/i, '').trim() ||
        (senderIsOwner ? 'Diselesaikan oleh Owner/Admin' : 'Ditutup oleh pelapor sendiri');

      if (!tNo) {
        await ctx.reply(
          formatError('Nomor Tiket Kosong', [
            `Contoh: ${mono(`${p}tiket tutup 1`)} atau ${mono(`${p}tiket tutup TKT-1234AB`)}`,
          ])
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
          not_found: `Nomor tiket ${mono(tNo)} tidak ditemukan. Cek daftar di ${mono(`${p}tiket`)} ♡`,
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

    // 3. Daftar tiket (.tiket -> otomatis tampilkan antrean komunitas juga bagi Owner jika .tiket admin atau belum punya tiket pribadi)
    const explicitAdmin = senderIsOwner && ['admin', 'all', 'semua'].includes(sub);
    let showAllOpen = explicitAdmin;
    let rows = listTicketsForUser(senderJid, { includeAllForAdmin: showAllOpen });
    if (!showAllOpen && senderIsOwner && rows.length === 0) {
      const adminOpen = listTicketsForUser(senderJid, { includeAllForAdmin: true });
      if (adminOpen.length > 0) {
        showAllOpen = true;
        rows = adminOpen;
      }
    }

    if (rows.length === 0) {
      await ctx.reply(
        renderBox(
          '🎫 ᴅᴀꜰᴛᴀʀ ᴛɪᴋᴇᴛ ʟᴀᴘᴏʀᴀɴ',
          [
            showAllOpen
              ? '✦ Tidak ada antrean tiket terbuka saat ini 🎉'
              : '✦ Kamu belum memiliki riwayat tiket laporan ♡',
            `◦ Buat laporan baru kapan saja dengan ${mono(`${p}lapor <pesan>`)}!`,
          ],
          { footer: config.footer }
        )
      );
      return;
    }

    const lines = [];
    rows.slice(0, 8).forEach((r, idx) => {
      const stIcon = r.status === 'open' ? '🟢 OPEN' : '🔒 CLOSED';
      lines.push(
        `✦ *[${idx + 1}] ${keep(r.ticket_no)}* [${keep(r.category.toUpperCase())}] — ${stIcon}`
      );
      if (showAllOpen) {
        lines.push(`  Pelapor : ${keep(r.user_name)}`);
      }
      lines.push(`  Subjek  : ${keep(r.subject)}`);
      if (r.assigned_to) {
        lines.push(`  Ditangani: ${keep(r.assigned_to)}`);
      }
    });

    lines.push('');
    lines.push(`◦ Balas cepat: ${mono(`${p}tiket balas 1 <pesan>`)} atau ${mono(`${p}tiket balas ${rows[0].ticket_no} <pesan>`)}`);
    lines.push(`◦ Tutup cepat: ${mono(`${p}tiket tutup 1`)}`);
    if (senderIsOwner && !showAllOpen) {
      lines.push(`◦ Antrean Semua Member: ${mono(`${p}tiket admin`)}`);
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
