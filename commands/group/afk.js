const config = require('../../config');
const {
  setUserAfk,
  formatMentionTag,
  ensureGroup,
} = require('../../lib/database');
const { detectDisallowedLink } = require('../../lib/group-guard');
const { formatError, boldSans, keep, DIVIDER } = require('../../lib/smallcaps');

module.exports = {
  name: 'afk',
  alias: ['izin', 'istirahat'],
  category: 'group',
  description: 'Pasang status AFK otomatis saat kamu di-tag atau di-reply di grup',
  cooldown: 5,
  groupOnly: true,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      chatJid,
      senderJid,
      pushName,
      isOwner: senderIsOwner,
      isAdmin,
      isBotAdmin,
      text,
    } = ctx;

    const rawReason = String(text || '').trim();

    // Cegah penyelundupan tautan lewat alasan .afk saat Antilink aktif
    if (rawReason && !senderIsOwner && !isAdmin) {
      const groupRow = ensureGroup(chatJid);
      if (groupRow?.antilink) {
        const badLink = await detectDisallowedLink(sock, chatJid, rawReason, isBotAdmin, {
          allowDownloaderCmd: false,
        });
        if (badLink) {
          await ctx.reply(
            formatError('Tautan Tidak Diizinkan', [
              'Alasan AFK tidak boleh berisi tautan luar saat Antilink grup aktif.',
            ])
          );
          return;
        }
      }
    }

    const afkState = setUserAfk(senderJid, rawReason || 'Sedang istirahat / sibuk');
    const tag = formatMentionTag(senderJid, pushName);

    const out = [
      `💤 *${boldSans('STATUS AFK AKTIF')}*`,
      DIVIDER,
      `• ${tag} sekarang sedang AFK.`,
      `• Alasan : ${afkState.reason}`,
    ].join('\n');

    await ctx.reply(out, {
      mentions: [senderJid],
    });
  },
};
