const config = require('../../config');
const { getDb, isOwner } = require('../../lib/database');
const {
  parseEventScheduleInput,
  createScheduledEvent,
  resolveScheduledEventByRef,
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

/**
 * Ekstrak jadwal + judul + deskripsi secara fleksibel tanpa harus memakai tanda "|"!
 * Mendukung:
 *   1) Format pipe lama : "2026-11-28 19:30 | Judul | Deskripsi"
 *   2) Hanya jam + judul: "20:00 Mabar Boss Ender Dragon"
 *   3) Relatif + judul  : "besok 19:30 Turnamen PvP - Hadiah Diamond"
 *   4) Rutin + judul    : "harian 19:00 Kumpul Malam" / "sabtu 20:00 Boss Raid" / "mingguan sabtu 20:00 Boss Raid"
 *   5) Tanggal + judul  : "28/11 19:30 Event Akhir Bulan" / "2026-11-28 19:30 Lomba Build"
 *   6) Judul dulu + jam : "Mabar Boss Ender Dragon 20:00"
 */
function parseEasyEventCommand(rawBody = '') {
  const body = String(rawBody || '').trim();
  if (!body) return null;

  // 1. Jika user tetap menggunakan pemisah "|", dukung penuh seperti semula
  if (body.includes('|')) {
    const parts = body.split('|').map((s) => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return {
        rawSchedule: parts[0],
        title: parts[1],
        description: parts.slice(2).join(' | '),
      };
    }
    return null;
  }

  // Helper pisahkan "Judul - Deskripsi" opsional
  const splitTitleDesc = (restText) => {
    const trimmed = String(restText || '').trim();
    const dashIdx = trimmed.indexOf(' - ');
    if (dashIdx > 0) {
      return {
        title: trimmed.slice(0, dashIdx).trim(),
        description: trimmed.slice(dashIdx + 3).trim(),
      };
    }
    return { title: trimmed, description: '' };
  };

  // 2. Coba cocokkan jadwal di bagian depan kalimat (1 s/d 3 kata pertama)
  const tokens = body.split(/\s+/);
  for (const wordCount of [3, 2, 1]) {
    if (tokens.length <= wordCount) continue;
    const candidateSched = tokens.slice(0, wordCount).join(' ');
    const check = parseEventScheduleInput(candidateSched);
    if (check.valid) {
      const { title, description } = splitTitleDesc(tokens.slice(wordCount).join(' '));
      if (title) {
        return { rawSchedule: candidateSched, title, description };
      }
    }
  }

  // 3. Coba cocokkan jam di bagian paling belakang kalimat ("Mabar Boss 20:00")
  if (tokens.length >= 2) {
    const lastOne = tokens[tokens.length - 1];
    if (parseEventScheduleInput(lastOne).valid) {
      const { title, description } = splitTitleDesc(tokens.slice(0, -1).join(' '));
      if (title) {
        return { rawSchedule: lastOne, title, description };
      }
    }
  }

  return null;
}

module.exports = {
  name: 'event',
  alias: ['jadwal', 'events', 'agenda'],
  category: 'community',
  description: 'Lihat jadwal event komunitas CipiSMP (WIB) atau kelola pengingat otomatis dengan mudah',
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
    if (sub === 'list' || sub === 'daftar' || !args[0]) {
      const events = listScheduledEvents(true);
      if (events.length === 0) {
        const emptyLines = [
          '✦ Belum ada jadwal event terjadwal saat ini ♡',
          '◦ Pantau terus grup & Discord CipiSMP untuk kejutan seru berikutnya!',
        ];
        if (senderIsOwner) {
          emptyLines.push('');
          emptyLines.push('❖ Cara Mudah Buat Event (Tanpa Simbol Rumit):');
          emptyLines.push(`◦ Hari ini : ${mono(`${p}event tambah 20:00 Mabar Boss Dragon`)}`);
          emptyLines.push(`◦ Besok    : ${mono(`${p}event tambah besok 19:30 Turnamen PvP`)}`);
          emptyLines.push(`◦ Harian   : ${mono(`${p}event tambah harian 19:00 Kumpul Malam`)}`);
          emptyLines.push(`◦ Mingguan : ${mono(`${p}event tambah sabtu 20:00 Boss Raid`)}`);
        }

        await ctx.reply(
          renderBox('✿ ᴀɢᴇɴᴅᴀ ᴇᴠᴇɴᴛ ᴄɪᴘɪsᴍᴘ (ᴡɪʙ)', emptyLines, {
            footer: config.footer,
          })
        );
        return;
      }

      const lines = [];
      events.forEach((ev, idx) => {
        const schedStr = ev.is_recurring
          ? `Rutin (${keep(ev.cron_expr)} WIB)`
          : `Sekali (${keep(getWibParts(new Date(Number(ev.run_at))).timestamp)})`;

        lines.push(`✦ *${idx + 1}.* [${keep(ev.code)}] *${keep(ev.title)}*`);
        lines.push(`  Jadwal : ${schedStr}`);
        if (ev.description) {
          lines.push(`  Info   : ${keep(ev.description)}`);
        }
        lines.push('');
      });

      if (senderIsOwner) {
        lines.push(`◦ Hapus cepat: ${mono(`${p}event hapus 1`)} | Uji: ${mono(`${p}event uji 1`)}`);
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

    // 2. Uji tembak notifikasi event sekarang (.event uji 1 atau .event uji EV-XXXX)
    if (sub === 'uji' || sub === 'test' || sub === 'fire') {
      const ref = args[1] || '';
      const row = resolveScheduledEventByRef(ref);
      if (!row) {
        await ctx.reply(
          formatError('Event Tidak Ditemukan', [
            `Nomor/kode ${keep(ref || '(kosong)')} tidak ditemukan. Cek nomor urut di ${mono(`${p}event`)} ya ♡`,
          ])
        );
        return;
      }
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

    // 3. Hapus event (.event hapus 1 atau .event hapus EV-XXXX)
    if (sub === 'hapus' || sub === 'del' || sub === 'delete') {
      const code = args[1] || '';
      const del = deleteScheduledEvent(code);
      if (!del.ok) {
        await ctx.reply(
          formatError('Event Tidak Ditemukan', [
            `Cek nomor urut di ${mono(`${p}event`)}, lalu ketik contoh: ${mono(`${p}event hapus 1`)} ♡`,
          ])
        );
        return;
      }
      await ctx.reply(
        formatSuccess('Event Dihapus', [
          `Jadwal event ${keep(del.code)} (${keep(del.title)}) berhasil dihapus ✿`,
        ])
      );
      return;
    }

    // 4. Tambah event baru (.event tambah ... ATAU langsung .event 20:00 Judul / .event sabtu 20:00 Judul)
    const isExplicitAdd = ['tambah', 'add', 'buat'].includes(sub);
    const rawAddBody = isExplicitAdd ? text.slice((args[0] || '').length).trim() : text.trim();
    const parsedEasy = parseEasyEventCommand(rawAddBody);

    if (isExplicitAdd || parsedEasy) {
      if (!parsedEasy) {
        await ctx.reply(
          formatError('Cara Mudah Buat Event', [
            'Cukup tulis waktu & nama acaranya (tanpa simbol rumit!):',
            `◦ Jam hari ini : ${mono(`${p}event tambah 20:00 Mabar Boss Ender Dragon`)}`,
            `◦ Besok        : ${mono(`${p}event tambah besok 19:30 Lomba Build Sakura`)}`,
            `◦ Setiap hari  : ${mono(`${p}event tambah harian 19:00 Sapa Malam CipiSMP`)}`,
            `◦ Setiap pekan : ${mono(`${p}event tambah sabtu 20:00 Boss Raid - Kumpul di Spawn`)}`,
            `◦ Tanggal      : ${mono(`${p}event tambah 28/11 19:30 Event Akhir Bulan`)}`,
          ])
        );
        return;
      }

      const res = createScheduledEvent({
        rawSchedule: parsedEasy.rawSchedule,
        title: parsedEasy.title,
        description: parsedEasy.description,
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
          ...(parsedEasy.description ? [`✦ Info   : ${keep(parsedEasy.description)}`] : []),
          `✦ Tujuan : WhatsApp + Minecraft + Discord`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatError('Panduan Cepat Event', [
        `◦ Lihat jadwal : ${mono(`${p}event`)}`,
        `◦ Buat jadwal  : ${mono(`${p}event tambah 20:00 Nama Acara`)}`,
        `◦ Hapus jadwal : ${mono(`${p}event hapus 1`)}`,
        `◦ Uji kirim    : ${mono(`${p}event uji 1`)}`,
      ])
    );
  },
};
