const config = require('../../config');
const { DECODE_MODES, decodeText } = require('../../lib/codec');
const { ensureGroup } = require('../../lib/database');
const { detectDisallowedLink } = require('../../lib/group-guard');
const { formatError, boldSans, mono, keep, DIVIDER } = require('../../lib/smallcaps');

function extractQuotedCipher(quotedMessage) {
  if (!quotedMessage) return '';
  const raw = String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      ''
  ).trim();
  // Jika me-reply hasil output .ecode bot (ada garis DIVIDER), ambil bagian kode di bawahnya otomatis!
  if (raw.includes(DIVIDER)) {
    const parts = raw.split(DIVIDER);
    const tail = String(parts[parts.length - 1] || '').trim();
    if (tail) return tail;
  }
  return raw;
}

module.exports = {
  name: 'decode',
  alias: ['dcode', 'dec', 'bukasandi'],
  category: 'tools',
  description: 'Terjemahkan kembali sandi Base64, Hex, Biner, Morse, ROT13, atau URL (Auto-Detect)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      chatJid,
      isGroup,
      isOwner: senderIsOwner,
      isAdmin,
      isBotAdmin,
      args,
      text,
      quotedMessage,
    } = ctx;
    const p = config.prefix || '.';

    let mode = 'auto';
    let bodyCipher = String(text || '').trim();

    if (args.length >= 1 && Object.prototype.hasOwnProperty.call(DECODE_MODES, args[0].toLowerCase())) {
      const rest = bodyCipher.slice(args[0].length).trim();
      if (rest || quotedMessage) {
        mode = args[0].toLowerCase();
        bodyCipher = rest;
      }
    }

    const finalInput = bodyCipher || extractQuotedCipher(quotedMessage);
    if (!finalInput) {
      await ctx.reply(
        formatError('Format Decode / Buka Sandi', [
          `Auto-Detect    : ${mono(`${p}dcode <kode_sandi>`)} (atau reply pesan bersandi!)`,
          `Pilih manual   : ${mono(`${p}dcode rot13 <teks>`)} / ${mono(`${p}dcode morse <kode>`)}`,
          `Format didukung: ${mono('b64, hex, biner, morse, rot13, url, balik')}`,
        ])
      );
      return;
    }

    try {
      const { format, result } = decodeText(mode, finalInput);

      // Cegah penyelundupan tautan luar via sandi Base64/Hex/Biner di grup yang Antilink-nya aktif
      if (isGroup && !senderIsOwner && !isAdmin) {
        const groupRow = ensureGroup(chatJid);
        if (groupRow?.antilink) {
          const badLink = await detectDisallowedLink(sock, chatJid, result, isBotAdmin, {
            allowDownloaderCmd: false,
          });
          if (badLink) {
            await ctx.reply(
              formatError('Tautan Tersembunyi Diblokir', [
                'Hasil decode mengandung tautan luar yang tidak diizinkan saat Antilink grup aktif.',
              ])
            );
            return;
          }
        }
      }

      const out = [
        `🔓 *${boldSans(`HASIL DECODE (${format})`)}*`,
        DIVIDER,
        keep(result.slice(0, 2500)),
      ].join('\n');

      await ctx.reply(out);
    } catch (err) {
      await ctx.reply(
        formatError('Gagal Membuka Sandi', [
          keep(err.message),
        ])
      );
    }
  },
};
