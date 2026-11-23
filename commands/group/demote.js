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
  name: 'demote',
  alias: ['turunadmin', 'unadmin'],
  category: 'group',
  description: 'Turunkan jabatan Admin Grup menjadi anggota biasa',
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
          `Tandai admin atau balas pesannya dengan ${mono(`${p}demote @user`)} ya kak ♡`,
        ])
      );
      return;
    }

    const botJid = normalizeUserJid(sock?.user?.id || '');
    if (targetJid === botJid) {
      await ctx.reply(
        formatError('Tidak Bisa Demote Bot', [
          'Jangan turunkan aku dari admin ya kak, nanti fitur penjaga grup tidak jalan ♡',
        ])
      );
      return;
    }

    if (isOwner(targetJid) && !isOwner(senderJid)) {
      await ctx.reply(
        formatError('Target Dilindungi', [
          'Jabatan Owner bot tidak bisa diturunkan ya kak ♡',
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
          'User tersebut tidak ditemukan di dalam grup ini ♡',
        ])
      );
      return;
    }

    if (participantEntry.admin === 'superadmin') {
      await ctx.reply(
        formatError('Pembuat Grup', [
          'Pembuat utama grup (Superadmin) tidak dapat diturunkan oleh WhatsApp ♡',
        ])
      );
      return;
    }

    if (!participantEntry.admin) {
      await ctx.reply(
        formatError('Bukan Admin', [
          'Member tersebut memang belum berstatus Admin Grup kok ♡',
        ])
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(chatJid, [targetJid], 'demote');
      invalidateGroupCache(chatJid);

      addAuditLog({
        level: 'info',
        category: 'group',
        actorJid: senderJid,
        target: targetJid,
        action: 'demote_member',
        details: { groupJid: chatJid },
      });

      const tag = targetPhone ? `@${targetPhone}` : targetJid.split('@')[0];
      await sock.sendMessage(
        chatJid,
        {
          text: formatSuccess('Jabatan Admin Diturunkan', [
            `${tag} sekarang kembali menjadi anggota reguler grup ✿`,
          ]),
          mentions: [targetJid],
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:DEMOTE', 'Gagal demote admin', err);
      await ctx.reply(
        formatError('Gagal Menurunkan Admin', [
          'Maaf kak, terjadi kendala saat mengubah jabatan anggota.',
        ])
      );
    }
  },
};
