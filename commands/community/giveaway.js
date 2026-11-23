const config = require('../../config');
const { extractPhoneFromJid, isOwner } = require('../../lib/database');
const {
  parseDurationMs,
  createGiveaway,
  finishGiveaway,
  rerollGiveaway,
  cancelGiveaway,
  listActiveGiveaways,
} = require('../../lib/scheduler');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');
const { getWibParts, formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'giveaway',
  alias: ['gw', 'undian'],
  category: 'community',
  description: 'Lihat atau kelola sesi Giveaway berdurasi dengan undian pemenang otomatis',
  cooldown: 4,
  groupOnly: true,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      chatJid,
      senderJid,
      args,
      text,
      getGroupAdminFlags,
    } = ctx;
    const senderIsOwner = Boolean(ctx.isOwner || isOwner(senderJid));
    const p = config.prefix;
    const sub = (args[0] || 'list').toLowerCase();

    // 1. Tampilkan daftar Giveaway aktif di grup ini (bisa diakses semua member)
    if (sub === 'list' || sub === 'aktif' || !args[0]) {
      const activeList = listActiveGiveaways(chatJid);
      if (activeList.length === 0) {
        await ctx.reply(
          renderBox(
            '✿ ɢɪᴠᴇᴀᴡᴀʏ ᴋᴏᴍᴜɴɪᴛᴀs',
            [
              '✦ Saat ini belum ada Giveaway yang sedang berlangsung di grup ini ♡',
              '',
              '❖ Panduan Admin Grup:',
              `◦ ${mono(`${p}giveaway buat 30m | 2 | 1000 | VIP Sakura + 5 Diamond`)}`,
              `  (Format: durasi | jml_pemenang | bonus_koin | nama_hadiah)`,
            ],
            { footer: config.footer }
          )
        );
        return;
      }

      const lines = [];
      for (const gw of activeList) {
        let pCount = 0;
        try {
          pCount = JSON.parse(gw.participants_json || '[]').length;
        } catch {
          pCount = 0;
        }
        const endStr = getWibParts(new Date(Number(gw.ends_at))).timestamp;
        lines.push(`✦ Kode     : ${keep(gw.code)}`);
        lines.push(`  Hadiah   : ${keep(gw.prize)}`);
        if (Number(gw.prize_amount) > 0) {
          lines.push(
            `  Bonus    : +${formatNumber(gw.prize_amount)} ${config.economy.currencyName} / pemenang`
          );
        }
        lines.push(`  Pemenang : ${gw.winner_count} orang | Peserta: ${pCount} orang`);
        lines.push(`  Berakhir : ${keep(endStr)}`);
        lines.push(`  Daftar   : Ketik ${mono(`${p}ikut ${gw.code}`)}`);
        lines.push('');
      }

      const firstCode = activeList[0].code;
      const listBox = renderBox('🎉 ɢɪᴠᴇᴀᴡᴀʏ sᴇᴅᴀɴɢ ʙᴇʀʟᴀɴɢsᴜɴɢ', lines, {
        footer: config.footer,
      });

      await ctx.replyCard(null, listBox, {
        title: '🎉 Daftar Giveaway Aktif 🎉',
        isPublic: true,
        buttons: [
          {
            command: `${p}ikut ${firstCode}`,
            text: `✿ Ikut ${firstCode}`,
          },
        ],
      });
      return;
    }

    // Subcommand manajemen (buat / end / reroll / batal) wajib Admin Grup atau Owner
    let isGroupAdmin = Boolean(senderIsOwner || ctx.isAdmin);
    if (!isGroupAdmin && typeof getGroupAdminFlags === 'function') {
      const flags = await getGroupAdminFlags(chatJid, senderJid);
      isGroupAdmin = Boolean(flags.isAdmin);
    }

    if (!isGroupAdmin) {
      await ctx.reply(
        formatError('Khusus Admin Grup', [
          `Hanya Admin Grup atau Owner yang dapat mengelola sesi Giveaway ♡`,
          `Untuk ikut serta, cukup ketik ${mono(`${p}ikut`)} ya!`,
        ])
      );
      return;
    }

    // 2. Buat Giveaway baru (.giveaway buat <durasi> | [pemenang] | [koin] | <hadiah>)
    if (sub === 'buat' || sub === 'start' || sub === 'create') {
      const rawBody = text.slice((args[0] || '').length).trim();
      const parts = rawBody.split('|').map((s) => s.trim()).filter(Boolean);

      if (parts.length < 2) {
        await ctx.reply(
          formatError('Format Buat Giveaway', [
            'Gunakan salah satu format berikut:',
            `1. Lengkap: ${mono(`${p}giveaway buat 30m | 2 | 1000 | VIP Sakura`)}`,
            `2. Singkat: ${mono(`${p}giveaway buat 15m | 5x Diamond CipiSMP`)}`,
            'Satuan durasi: 30s (detik), 15m (menit), 2j (jam), 1hari.',
          ])
        );
        return;
      }

      const durationMs = parseDurationMs(parts[0]);
      if (!durationMs || durationMs < 10000 || durationMs > 7 * 86400 * 1000) {
        await ctx.reply(
          formatError('Durasi Tidak Valid', [
            'Durasi minimal 10 detik (10s) dan maksimal 7 hari (7hari) ya kak ♡',
          ])
        );
        return;
      }

      let winnerCount = 1;
      let prizeAmount = 0;
      let prizeLabel = '';

      if (parts.length === 2) {
        prizeLabel = parts[1];
      } else if (parts.length === 3) {
        winnerCount = Math.max(1, Number(parts[1]) || 1);
        prizeLabel = parts[2];
      } else {
        winnerCount = Math.max(1, Number(parts[1]) || 1);
        prizeAmount = Math.max(0, Number(parts[2]) || 0);
        prizeLabel = parts.slice(3).join(' | ');
      }

      const created = createGiveaway({
        hostRawJid: senderJid,
        groupJid: chatJid,
        durationMs,
        winnerCount,
        prizeAmount,
        prizeLabel,
      });

      const endWib = getWibParts(new Date(created.endsAt)).timestamp;
      const hostTag = extractPhoneFromJid(senderJid);

      const announceBox = renderBox(
        `🎉 ɢɪᴠᴇᴀᴡᴀʏ ᴅɪᴍᴜʟᴀɪ • ${keep(created.code)}`,
        [
          `✦ Hadiah     : ${keep(created.prizeLabel)}`,
          created.prizeAmount > 0
            ? `✦ Bonus Koin : +${formatNumber(created.prizeAmount)} ${config.economy.currencyName} / pemenang`
            : '',
          `✦ Pemenang   : ${created.winnerCount} orang beruntung`,
          hostTag ? `✦ Host       : @${hostTag}` : '',
          `✦ Diundi Pada: ${keep(endWib)}`,
          '',
          `◦ Klik tombol di bawah atau ketik ${mono(`${p}ikut ${created.code}`)} untuk mendaftar! ♡`,
        ].filter(Boolean),
        { footer: config.footer }
      );

      await ctx.replyCard(null, announceBox, {
        title: `🎉 Giveaway ${created.code} 🎉`,
        isPublic: true,
        mentions: [senderJid],
        buttons: [
          {
            command: `${p}ikut ${created.code}`,
            text: '✿ Ikut Giveaway!',
          },
          {
            command: `${p}giveaway list`,
            text: '✦ Cek Peserta',
          },
        ],
      });
      return;
    }

    // 3. Undi lebih cepat (.giveaway end <kode>)
    if (sub === 'end' || sub === 'undi' || sub === 'selesai') {
      const code = args[1] || '';
      if (!code) {
        await ctx.reply(
          formatError('Kode Belum Diisi', [`Contoh: ${mono(`${p}giveaway end GW-1A2B`)}`])
        );
        return;
      }
      const res = await finishGiveaway(code);
      if (!res.ok) {
        await ctx.reply(
          formatError('Giveaway Tidak Aktif', [
            `Giveaway dengan kode ${keep(code.toUpperCase())} tidak ditemukan atau sudah selesai ♡`,
          ])
        );
        return;
      }
      // Jika dryRun atau socket belum mengirim otomatis, balas langsung di sini
      if (config.dryRun || !sock) {
        await ctx.reply(res.announcementText);
      }
      return;
    }

    // 4. Reroll pemenang pengganti (.giveaway reroll <kode>)
    if (sub === 'reroll') {
      const code = args[1] || '';
      if (!code) {
        await ctx.reply(
          formatError('Kode Belum Diisi', [`Contoh: ${mono(`${p}giveaway reroll GW-1A2B`)}`])
        );
        return;
      }
      const rr = rerollGiveaway(code);
      if (!rr.ok) {
        await ctx.reply(
          formatError('Gagal Reroll', [
            'Pastikan kode giveaway sudah selesai dan memiliki peserta yang mendaftar ♡',
          ])
        );
        return;
      }
      const phone = extractPhoneFromJid(rr.newWinner);
      await sock.sendMessage(
        chatJid,
        {
          text: formatSuccess(`Reroll Giveaway ${keep(rr.code)}`, [
            `✦ Hadiah            : ${keep(rr.prize)}`,
            `✦ Pemenang Pengganti: @${phone || rr.newWinner} 🎉`,
          ]),
          mentions: [rr.newWinner],
        },
        { quoted: ctx.msg }
      );
      return;
    }

    // 5. Batalkan giveaway (.giveaway batal <kode>)
    if (sub === 'batal' || sub === 'cancel') {
      const code = args[1] || '';
      const cc = cancelGiveaway(code);
      if (!cc.ok) {
        await ctx.reply(
          formatError('Gagal Membatalkan', ['Kode giveaway aktif tidak ditemukan ♡'])
        );
        return;
      }
      await ctx.reply(
        formatSuccess('Giveaway Dibatalkan', [
          `Sesi giveaway ${keep(cc.code)} (${keep(cc.prize)}) telah dibatalkan ✿`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatError('Subcommand Tidak Dikenal', [
        `Pilihan: ${mono(`${p}giveaway list`)}, ${mono(`${p}giveaway buat`)}, ${mono(`${p}giveaway end`)}, ${mono(`${p}giveaway reroll`)}, ${mono(`${p}giveaway batal`)}.`,
      ])
    );
  },
};
