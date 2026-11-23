const config = require('../../config');
const { isOwner, formatMentionTag } = require('../../lib/database');
const { resolveTargetUserJid, banUser } = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const {
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'ban',
  alias: ['banuser', 'blokiruser'],
  category: 'owner',
  description: 'Batasi akses user tertentu dari seluruh fitur bot (Khusus Owner)',
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

    const targetJid = resolveTargetUserJid(ctx, args[0]);
    if (!targetJid) {
      return reply(
        formatWarning('Format Ban User', [
          `✦ Tag member, reply pesannya, atau tulis nomor WhatsApp-nya.`,
          `✦ Contoh 1: ${mono(`${prefix}ban @user Spam command berulang`)}`,
          `✦ Contoh 2: ${mono(`${prefix}ban 6281234567890 Penyalahgunaan fitur`)}`,
        ])
      );
    }

    // Ambil alasan: bila memakai argumen nomor/tag di args[0], alasan dimulai dari args[1]
    const firstIsTarget =
      args[0] && (args[0].startsWith('@') || /^[+0-9-]{7,}$/.test(args[0]));
    const reasonText = (firstIsTarget ? args.slice(1) : args).join(' ').trim();

    const res = banUser({
      actorJid: senderJid,
      targetRawJid: targetJid,
      reason: reasonText,
    });

    if (!res.ok) {
      if (res.reason === 'cannot_ban_owner') {
        return reply(
          formatError('Tidak Dapat Memblokir Owner', [
            '✦ Akun Owner CipiSMP dilindungi dan tidak bisa diblokir ♡',
          ])
        );
      }
      return reply(formatWarning('Target Tidak Valid', ['Nomor atau akun target tidak dikenali.']));
    }

    const mentionLabel = formatMentionTag(res.targetJid, res.name);
    const unbanArg = res.phone || res.targetJid;

    await sendButtons(sock, chatJid, {
      title: '❖ Akses User Dibatasi ❖',
      text: formatSuccess('User Berhasil Di-Ban 🔒', [
        `✦ Member : ${mentionLabel} (${keep(res.name)})`,
        `✦ Alasan : ${keep(res.banReason)}`,
        `◦ Buka kembali kapan saja dengan ${mono(`${prefix}unban ${unbanArg}`)}`,
      ]),
      footer: config.footer,
      ownerJid: senderJid,
      mentions: [res.targetJid],
      quoted: msg,
      buttons: [
        { id: `${prefix}unban ${unbanArg}`, text: '🔓 Cabut Ban' },
        { id: `${prefix}banlist`, text: '📋 Daftar Ban' },
      ],
    });
  },
};
