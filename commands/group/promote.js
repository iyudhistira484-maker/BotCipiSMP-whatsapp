const config = require('../../config');
const {
  normalizeUserJid,
  extractPhoneFromJid,
  addAuditLog,
} = require('../../lib/database');
const { resolveTargetParticipant } = require('../../lib/group-guard');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'promote',
  alias: ['jadiadmin', 'addadmin'],
  category: 'group',
  description: 'Angkat anggota menjadi Admin Grup (@mention atau balas pesannya)',
  cooldown: 5,
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, groupMeta, invalidateGroupCache } = ctx;
    const p = config.prefix;

    const targetJid = resolveTargetParticipant(ctx);
    if (!targetJid) {
      await ctx.reply(
        formatError('Target Belum Dipilih', [
          `Tandai member atau balas pesannya dengan ${mono(`${p}promote @user`)} ya kak ♡`,
        ])
      );
      return;
    }

    const targetPhone = extractPhoneFromJid(targetJid);
    const participantEntry = (groupMeta?.participants || []).find((m) => {
      const mJid = normalizeUserJid(m.jid || m.phoneNumber || m.id || '');
      return mJid === targetJid || (targetPhone && extractPhoneFromJid(mJid) === targetPhone);
    });

    if (!participantEntry) {
      await ctx.reply(
        formatError('Tidak Ditemukan', [
          'User tersebut tidak berada di grup ini nih ♡',
        ])
      );
      return;
    }

    if (participantEntry.admin === 'admin' || participantEntry.admin === 'superadmin') {
      await ctx.reply(
        formatError('Sudah Admin', [
          'Kakak tersebut memang sudah menjadi Admin Grup kok ♡',
        ])
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(chatJid, [targetJid], 'promote');
      invalidateGroupCache(chatJid);

      addAuditLog({
        level: 'info',
        category: 'group',
        actorJid: senderJid,
        target: targetJid,
        action: 'promote_member',
        details: { groupJid: chatJid },
      });

      const tag = targetPhone ? `@${targetPhone}` : `@${targetJid.split('@')[0]}`;
      await sock.sendMessage(
        chatJid,
        {
          text: formatSuccess('Admin Baru Diangkat', [
            `Selamat ${tag}, sekarang kamu resmi menjadi Admin Grup ✦`,
          ]),
          mentions: [targetJid],
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:PROMOTE', 'Gagal promote member', err);
      await ctx.reply(
        formatError('Gagal Menaikkan Admin', [
          'Maaf kak, terjadi kendala saat mengangkat admin grup.',
        ])
      );
    }
  },
};
