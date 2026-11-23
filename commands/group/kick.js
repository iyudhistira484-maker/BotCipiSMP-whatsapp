const config = require('../../config');
const {
  normalizeUserJid,
  extractPhoneFromJid,
  isOwner,
  addAuditLog,
} = require('../../lib/database');
const { resolveTargetParticipant } = require('../../lib/group-guard');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'kick',
  alias: ['remove', 'tendang'],
  category: 'group',
  description: 'Keluarkan anggota dari grup (@mention atau balas pesannya)',
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
          `Tandai orangnya atau balas pesannya dengan ${mono(`${p}kick @user`)} ya kak ♡`,
        ])
      );
      return;
    }

    const botJid = normalizeUserJid(sock?.user?.id || '');
    if (targetJid === botJid) {
      await ctx.reply(
        formatError('Eits Jangan Aku', [
          'Masa aku disuruh mengeluarkan diriku sendiri sih kak ♡',
        ])
      );
      return;
    }

    if (isOwner(targetJid)) {
      await ctx.reply(
        formatError('Target Dilindungi', [
          'Tidak bisa mengeluarkan Owner bot dari grup ya kak ♡',
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
        formatError('Tidak Ada di Grup', [
          'Member tersebut tidak ditemukan di dalam grup ini nih ♡',
        ])
      );
      return;
    }

    if (participantEntry.admin === 'superadmin' || participantEntry.admin === 'admin') {
      await ctx.reply(
        formatError('Target Adalah Admin', [
          `Turunkan status adminnya dulu dengan ${mono(`${p}demote`)} sebelum dikeluarkan ya ♡`,
        ])
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(chatJid, [targetJid], 'remove');
      invalidateGroupCache(chatJid);

      addAuditLog({
        level: 'info',
        category: 'group',
        actorJid: senderJid,
        target: targetJid,
        action: 'kick_member',
        details: { groupJid: chatJid },
      });

      const tag = targetPhone ? `@${targetPhone}` : targetJid.split('@')[0];
      await sock.sendMessage(
        chatJid,
        {
          text: formatSuccess('Anggota Dikeluarkan', [
            `${tag} telah dikeluarkan dari grup ✿`,
          ]),
          mentions: [targetJid],
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:KICK', 'Gagal mengeluarkan member grup', err);
      await ctx.reply(
        formatError('Gagal Mengeluarkan', [
          'Pastikan aku masih berstatus Admin Grup dan nomor target valid ya ♡',
        ])
      );
    }
  },
};
