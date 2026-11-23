const config = require('../../config');
const { isOwner } = require('../../lib/database');
const { resolveTargetUserJid, grantPremium } = require('../../lib/owner-manager');
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
    const { sock, msg, chatJid, senderJid, args, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const firstIsTarget =
      args[0] && (args[0].startsWith('@') || /^[+0-9-]{7,}$/.test(args[0]));
    const targetJid = resolveTargetUserJid(ctx, firstIsTarget ? args[0] : '');
    const durationInput = firstIsTarget ? args[1] : args[0];
    const noteText = (firstIsTarget ? args.slice(2) : args.slice(1)).join(' ').trim();

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

    await sendButtons(sock, chatJid, {
      title: '❖ Sakura VIP CipiSMP ❖',
      text: formatSuccess(titleMsg, [
        `✦ Member      : ${keep(res.name)} (@${res.phone || res.targetJid})`,
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
        { id: `${prefix}delprem ${res.phone}`, text: '🗑️ Cabut VIP' },
      ],
    });
  },
};
