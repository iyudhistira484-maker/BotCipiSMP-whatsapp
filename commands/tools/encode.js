const config = require('../../config');
const { ENCODE_MODES, encodeText } = require('../../lib/codec');
const { formatError, boldSans, mono, keep, DIVIDER } = require('../../lib/smallcaps');

function extractQuotedText(quotedMessage) {
  if (!quotedMessage) return '';
  return String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      ''
  ).trim();
}

module.exports = {
  name: 'encode',
  alias: ['ecode', 'enc', 'sandi'],
  category: 'tools',
  description: 'Ubah teks menjadi sandi Base64, Hex, Biner, Morse, ROT13, URL, atau Hash',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { args, text, quotedMessage } = ctx;
    const p = config.prefix || '.';

    let mode = 'base64';
    let bodyText = String(text || '').trim();

    if (args.length >= 1 && Object.prototype.hasOwnProperty.call(ENCODE_MODES, args[0].toLowerCase())) {
      const rest = bodyText.slice(args[0].length).trim();
      if (rest || quotedMessage) {
        mode = args[0].toLowerCase();
        bodyText = rest;
      }
    }

    const finalInput = bodyText || extractQuotedText(quotedMessage);
    if (!finalInput) {
      await ctx.reply(
        formatError('Format Encode / Sandi', [
          `Cepat (Base64) : ${mono(`${p}ecode Rahasia CipiSMP`)}`,
          `Pilih format   : ${mono(`${p}ecode morse Halo Cipi`)}`,
          `Format tersedia: ${mono('b64, hex, biner, morse, rot13, url, balik, md5, sha256')}`,
          `Tips           : Bisa juga reply chat teman lalu ketik ${mono(`${p}ecode morse`)}!`,
        ])
      );
      return;
    }

    try {
      const { format, result } = encodeText(mode, finalInput);
      const out = [
        `🔐 *${boldSans(`HASIL ENCODE (${format})`)}*`,
        DIVIDER,
        keep(result.slice(0, 2500)),
      ].join('\n');

      await ctx.reply(out);
    } catch (err) {
      await ctx.reply(
        formatError('Gagal Encode Teks', [
          keep(err.message),
        ])
      );
    }
  },
};
