const config = require('../../config');
const { getDb, isOwner } = require('../../lib/database');
const {
  createScheduledEvent,
  deleteScheduledEvent,
  listScheduledEvents,
  fireScheduledEvent,
} = require('../../lib/scheduler');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');
const { getWibParts } = require('../../lib/logger');

module.exports = {
  name: 'event',
  alias: ['jadwal', 'events', 'agenda'],
  category: 'community',
  description: 'Lihat jadwal event komunitas CipiSMP (WIB) atau kelola pengingat cron',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { chatJid, isGroup, senderJid, args, text } = ctx;
    const senderIsOwner = Boolean(ctx.isOwner || isOwner(senderJid));
    const p = config.prefix;
    const sub = (args[0] || 'list').toLowerCase();

    // 1. Tampilkan daftar Event aktif (dapat dilihat semua member)
    if (sub === 'list' || !args[0]) {
      const events = listScheduledEvents(true);
      if (events.length === 0) {
        const emptyLines = [
          '✦ Belum ada jadwal event terjadwal saat ini ♡',
          '◦ Pantau terus grup & Discord CipiSMP untuk kejutan seru berikutnya!',
        ];
        if (senderIsOwner) {
          emptyLines.push('');
          emptyLines.push('❖ Panduan Owner:');
          emptyLines.push(
            `◦ Sekali : ${mono(`${p}event tambah 2026-11-28 19:30 | Turnamen PvP | Hadiah Diamond!`)}`
          );
          emptyLines.push(
            `◦ Harian : ${mono(`${p}event tambah harian 19:00 | Kumpul Malam | Ayo mabar!`)}`
          );
          emptyLines.push(
            `◦ Mingguan: ${mono(`${p}event tambah mingguan sabtu 20:00 | Boss Raid | Kumpul di Spawn`)}`
          );
        }

        await ctx.reply(
          renderBox('✿ ᴀɢᴇɴᴅᴀ ᴇᴠᴇɴᴛ ᴄɪᴘɪsᴍᴘ (ᴡɪʙ)', emptyLines, {
            footer: config.footer,
          })
        );
        return;
      }

      const lines = [];
      for (const ev of events) {
        const schedStr = ev.is_recurring
          ? `Rutin (${keep(ev.cron_expr)} WIB)`
          : `Sekali (${keep(getWibParts(new Date(Number(ev.run_at))).timestamp)})`;

        lines.push(`✦ [${keep(ev.code)}] *${keep(ev.title)}*`);
        lines.push(`  Jadwal : ${schedStr}`);
        if (ev.description) {
          lines.push(`  Info   : ${keep(ev.description)}`);
        }
        lines.push('');
      }

      await ctx.reply(
        renderBox('✿ ᴀɢᴇɴᴅᴀ ᴇᴠᴇɴᴛ ᴄɪᴘɪsᴍᴘ (ᴡɪʙ)', lines, {
          footer: config.footer,
        })
      );
      return;
    }

    // Manajemen jadwal event khusus Owner
    if (!senderIsOwner) {
      await ctx.reply(
        formatError('Khusus Owner', [
          `Hanya Owner yang dapat menambah atau menghapus jadwal event otomatis ♡`,
          `Ketik ${mono(`${p}event`)} untuk melihat daftar event yang akan datang!`,
        ])
      );
      return;
    }

    // 2. Tambah event baru (.event tambah <jadwal WIB> | <judul> | [deskripsi])
    if (sub === 'tambah' || sub === 'add' || sub === 'buat') {
      const rawBody = text.slice((args[0] || '').length).trim();
      const parts = rawBody.split('|').map((s) => s.trim());

      if (parts.length < 2 || !parts[0] || !parts[1]) {
        await ctx.reply(
          formatError('Format Tambah Event', [
            'Pisahkan jadwal, judul, dan deskripsi dengan tanda "|":',
            `◦ Sekali  : ${mono(`${p}event tambah 2026-11-28 19:30 | Lomba Build | Tema Kastil Sakura`)}`,
            `◦ Harian  : ${mono(`${p}event tambah harian 19:00 | Sapa Malam | Ayo login bareng!`)}`,
            `◦ Mingguan: ${mono(`${p}event tambah mingguan minggu 20:00 | Boss Fight | Arena Utama`)}`,
          ])
        );
        return;
      }

      const res = createScheduledEvent({
        rawSchedule: parts[0],
        title: parts[1],
        description: parts.slice(2).join(' | '),
        targetGroups: isGroup ? [chatJid] : [],
        actorJid: senderJid,
      });

      if (!res.ok) {
        await ctx.reply(formatError('Jadwal Tidak Valid', [res.reason]));
        return;
      }

      await ctx.reply(
        formatSuccess('Event Terjadwal Disimpan!', [
          `✦ Kode   : ${keep(res.code)}`,
          `✦ Judul  : ${keep(res.title)}`,
          `✦ Waktu  : ${keep(res.scheduleLabel)}`,
          `✦ Tujuan : WhatsApp + Minecraft + Discord`,
        ])
      );
      return;
    }

    // 3. Uji tembak notifikasi event sekarang (.event uji <EV-XXXX>)
    if (sub === 'uji' || sub === 'test' || sub === 'fire') {
      const code = (args[1] || '').toUpperCase();
      const row = getDb().get('SELECT * FROM events WHERE UPPER(code) = ?', [code]);
      if (!row) {
        await ctx.reply(formatError('Event Tidak Ditemukan', [`Kode ${keep(code)} tidak ditemukan ♡`]));
        return;
      }
      // Pertahankan status aktif jika hanya diuji
      const wasOneTime = !row.is_recurring;
      await fireScheduledEvent(row);
      if (wasOneTime) {
        getDb().run('UPDATE events SET active = 1 WHERE id = ?', [row.id]);
      }
      await ctx.reply(
        formatSuccess('Pengingat Event Diuji!', [
          config.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
          `Notifikasi untuk ${keep(row.code)} (${keep(row.title)}) telah dikirim ke platform tujuan ♡`,
        ].filter(Boolean))
      );
      return;
    }

    // 4. Hapus event (.event hapus <EV-XXXX>)
    if (sub === 'hapus' || sub === 'del' || sub === 'delete') {
      const code = args[1] || '';
      const del = deleteScheduledEvent(code);
      if (!del.ok) {
        await ctx.reply(formatError('Kode Tidak Ditemukan', ['Kode event tidak ditemukan ♡']));
        return;
      }
      await ctx.reply(
        formatSuccess('Event Dihapus', [
          `Jadwal event ${keep(del.code)} (${keep(del.title)}) berhasil dihapus ✿`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatError('Subcommand Event', [
        `Gunakan ${mono(`${p}event`)}, ${mono(`${p}event tambah`)}, ${mono(`${p}event uji <kode>`)}, atau ${mono(`${p}event hapus <kode>`)}.`,
      ])
    );
  },
};
