const config = require('../../config');
const {
  ENCODE_MODES,
  extractScriptDocument,
  buildOutputFileName,
  encodeText,
} = require('../../lib/codec');
const { formatError, boldSans, mono, keep, DIVIDER } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

function extractQuotedText(quotedMessage) {
  if (!quotedMessage) return '';
  return String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      quotedMessage.documentMessage?.caption ||
      ''
  ).trim();
}

module.exports = {
  name: 'encode',
  alias: ['ecode', 'enc', 'obf', 'sandi'],
  category: 'tools',
  description: 'Enkripsi / obfuscate kode script JavaScript (.js atau chat) maupun sandi teks',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, args, text, quotedMessage } = ctx;
    const p = config.prefix || '.';

    let mode = 'auto';
    let bodyText = String(text || '').trim();

    if (args.length >= 1 && Object.prototype.hasOwnProperty.call(ENCODE_MODES, args[0].toLowerCase())) {
      mode = args[0].toLowerCase();
      bodyText = bodyText.slice(args[0].length).trim();
    }

    let docInput = null;
    try {
      docInput = await extractScriptDocument(ctx);
    } catch (docErr) {
      await ctx.reply(formatError('Gagal Membaca File Script', [keep(docErr.message)]));
      return;
    }

    const finalInput = docInput ? docInput.content : bodyText || extractQuotedText(quotedMessage);
    if (!finalInput) {
      await ctx.reply(
        formatError('Enkripsi Script / Encode', [
          `File .js       : Reply file ${mono('.js')} lalu ketik ${mono(`${p}ecode`)} (atau ${mono(`${p}ecode pack`)})`,
          `Kode di chat   : ${mono(`${p}ecode const x = 10; console.log(x);`)}`,
          `Sandi teks     : ${mono(`${p}ecode b64 <teks>`)} / ${mono('hex, biner, morse, rot13')}`,
        ])
      );
      return;
    }

    try {
      const encoded = encodeText(mode, finalInput, {
        fileName: docInput?.fileName || '',
      });

      // Jika input dari file dokumen .js atau hasil script panjang (> 1600 karakter), kirim sebagai file .js siap pakai!
      if (docInput || (encoded.isScript && encoded.result.length > 1600)) {
        const outName = buildOutputFileName(docInput?.fileName || 'script.js', 'enc');
        const outBuf = Buffer.from(encoded.result, 'utf8');
        const caption = [
          `🔐 *${boldSans('SCRIPT BERHASIL DI-ENCODE')}*`,
          DIVIDER,
          `• Mode   : *${encoded.format}*`,
          `• Ukuran : *${(outBuf.length / 1024).toFixed(1)} KB*`,
          encoded.isScript ? `• Syntax : *Valid JS*` : '',
        ]
          .filter(Boolean)
          .join('\n');

        await sock.sendMessage(
          chatJid,
          {
            document: outBuf,
            mimetype: 'application/javascript',
            fileName: outName,
            caption,
          },
          { quoted: msg }
        );
        return;
      }

      const formattedBody = encoded.isScript
        ? `\`\`\`js\n${encoded.result}\n\`\`\``
        : encoded.result.slice(0, 2500);

      const out = [
        `🔐 *${boldSans(`HASIL ENCODE (${encoded.format})`)}*`,
        DIVIDER,
        keep(formattedBody),
      ].join('\n');

      await ctx.reply(out);
    } catch (err) {
      logger.warn('CMD:ENCODE', `Gagal encode: ${err.message}`);
      await ctx.reply(
        formatError('Gagal Encode Script / Teks', [
          keep(err.message),
        ])
      );
    }
  },
};
