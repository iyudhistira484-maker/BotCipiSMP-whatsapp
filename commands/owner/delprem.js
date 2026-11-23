const { isOwner } = require('../../lib/database');
const { resolveTargetUserJid, revokePremium } = require('../../lib/owner-manager');
const {
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'delprem',
  alias: ['delvip', 'hapusprem', 'cabutvip'],
  category: 'owner',
  description: 'Cabut atau hentikan status Sakura VIP member tertentu (Khusus Owner)',
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
        formatWarning('Format Cabut Sakura VIP', [
          `✦ Tag member, reply pesannya, atau tulis nomor WhatsApp-nya.`,
          `✦ Contoh: ${mono(`${prefix}delprem 6281234567890`)} atau cek ${mono(`${prefix}listprem`)}`,
        ])
      );
    }

    const res = revokePremium({
      actorJid: senderJid,
      targetRawJid: targetJid,
    });

    return reply(
      formatSuccess('Status Sakura VIP Dicabut', [
        `✦ Member : ${keep(res.name)} (@${res.phone || res.targetJid})`,
        `✦ Status : Kembali menjadi Member Reguler.`,
      ]),
      { mentions: [res.targetJid] }
    );
  },
};
