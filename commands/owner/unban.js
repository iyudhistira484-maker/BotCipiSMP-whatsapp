const config = require('../../config');
const { isOwner, formatMentionTag } = require('../../lib/database');
const { resolveTargetUserJid, unbanUser } = require('../../lib/owner-manager');
const {
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'unban',
  alias: ['unbanuser', 'bukablokir'],
  category: 'owner',
  description: 'Pulihkan kembali akses user yang sebelumnya di-ban (Khusus Owner)',
  cooldown: 2,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, args, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const targetJid = resolveTargetUserJid(ctx, args[0]);
    if (!targetJid) {
      return reply(
        formatWarning('Format Unban User', [
          `✦ Tag member, reply pesannya, atau tulis nomor WhatsApp-nya.`,
          `✦ Contoh: ${mono(`${prefix}unban 6281234567890`)} atau lihat ${mono(`${prefix}banlist`)}`,
        ])
      );
    }

    const res = unbanUser({
      actorJid: senderJid,
      targetRawJid: targetJid,
    });

    if (!res.ok) {
      return reply(formatWarning('Target Tidak Valid', ['Nomor atau akun target tidak dikenali.']));
    }

    return reply(
      formatSuccess('Akses User Dipulihkan! 🔓', [
        `✦ Member : ${formatMentionTag(res.targetJid, res.name)} (${keep(res.name)})`,
        `✦ Status : Aktif kembali di ${config.botName} ♡`,
      ]),
      { mentions: [res.targetJid] }
    );
  },
};
