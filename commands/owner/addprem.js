const config = require('../../config');
const { isOwner, formatMentionTag } = require('../../lib/database');
const {
  resolveTargetUserJid,
  parseVipDurationMs,
  grantPremium,
} = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const {
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'addprem',
  alias: ['addvip', 'tambahprem', 'beri-vip'],
  category: 'owner',
  description: 'Berikan atau perpanjang status Sakura VIP berdurasi kepada member (Khusus Owner)',
  cooldown: 2,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, mentionedJids, quotedSenderJid, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const hasMentionOrReply = Boolean(
      (mentionedJids && mentionedJids.length > 0) || quotedSenderJid
    );

    const firstIsTarget =
      args[0] && (args[0].startsWith('@') || /^[+0-9-]{7,}$/.test(args[0]));
    const targetJid = resolveTargetUserJid(ctx, firstIsTarget ? args[0] : '');

    let durationInput = '';
    let noteText = '';

    if (hasMentionOrReply) {
      // Kebal terhadap nama kontak @mention berspasi (misal: .addprem @Cello Cristia 30d Hadiah)
      let durIdx = -1;
      for (let i = 0; i < args.length; i += 1) {
        const tok = String(args[i] || '');
        if (tok.startsWith('@')) continue;
        // Gabungan dua kata seperti "30 hari" / "1 bulan"
        if (
          /^\d+$/.test(tok) &&
          args[i + 1] &&
          /^(?:m|menit|h|j|jam|d|hari|w|minggu|mo|bln|bulan|y|thn|tahun)$/i.test(args[i + 1])
        ) {
          durationInput = `${tok}${args[i + 1]}`;
          noteText = args.slice(i + 2).join(' ').trim();
          durIdx = i;
          break;
        }
        // Hindari angka 9+ digit yang merupakan nomor telepon/LID
        if (/^\d{9,}$/.test(tok)) continue;
        if (parseVipDurationMs(tok)) {
          durationInput = tok;
          noteText = args.slice(i + 1).join(' ').trim();
          durIdx = i;
          break;
        }
      }
      // Jika men-tag/reply member tanpa menulis durasi, otomatis berikan 30d!
      if (durIdx === -1 && targetJid) {
        durationInput = '30d';
      }
    } else {
      durationInput = firstIsTarget ? args[1] : args[0];
      noteText = (firstIsTarget ? args.slice(2) : args.slice(1)).join(' ').trim();
      if (firstIsTarget && !durationInput && targetJid) {
        durationInput = '30d';
      }
    }

    if (!targetJid || !durationInput) {
      return reply(
        formatWarning('Format Tambah Sakura VIP', [
          `✦ Tag member, reply pesannya, atau tulis nomor WA diikuti durasi.`,
          `✦ Contoh 1: ${mono(`${prefix}addprem @user 30d Hadiah Event`)}`,
          `✦ Contoh 2: ${mono(`${prefix}addprem 6281234567890 1bulan Donatur`)}`,
          `◦ Format durasi: ${mono('12h')}, ${mono('7d')}, ${mono('30d')}, ${mono('1bulan')}, ${mono('1tahun')}, atau ${mono('permanen')}`,
        ])
      );
    }

    const res = grantPremium({
      actorJid: senderJid,
      targetRawJid: targetJid,
      durationInput,
      tier: 'sakura',
      note: noteText,
    });

    if (!res.ok) {
      return reply(
        formatWarning('Durasi VIP Tidak Valid', [
          `✦ Gunakan format angka + satuan waktu, contoh: ${mono('7d')}, ${mono('30d')}, ${mono('1bulan')}, atau ${mono('permanen')}.`,
        ])
      );
    }

    const titleMsg = res.wasExtended
      ? 'Masa Aktif Sakura VIP Diperpanjang! 🌸'
      : 'Sakura VIP Berhasil Diaktifkan! 👑';
    const mentionLabel = formatMentionTag(res.targetJid, res.name);
    const revokeArg = res.phone || res.targetJid;

    await sendButtons(sock, chatJid, {
      title: '❖ Sakura VIP CipiSMP ❖',
      text: formatSuccess(titleMsg, [
        `✦ Member      : ${mentionLabel} (${keep(res.name)})`,
        `✦ Durasi      : +${keep(res.durationLabel)}`,
        `✦ Berlaku s/d : ${keep(res.expiresWib)}`,
        ...(res.note ? [`✦ Catatan     : ${keep(res.note)}`] : []),
        '',
        `◦ Limit AI ${config.limits.premium.ai}/hari, Downloader ${config.limits.premium.downloader}/hari, Cooldown 50% lebih cepat & Bonus +25% XP/Koin!`,
      ]),
      footer: config.footer,
      ownerJid: senderJid,
      mentions: [res.targetJid],
      quoted: msg,
      buttons: [
        { id: `${prefix}listprem`, text: '👑 Daftar Member VIP' },
        { id: `${prefix}delprem ${revokeArg}`, text: '🗑️ Cabut VIP' },
      ],
    });
  },
};
