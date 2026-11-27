const config = require('../../config');
const {
  DECODE_MODES,
  extractScriptDocument,
  buildOutputFileName,
  decodeText,
} = require('../../lib/codec');
const { ensureGroup } = require('../../lib/database');
const { detectDisallowedLink } = require('../../lib/group-guard');
const { formatError, boldSans, mono, keep, DIVIDER } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

function extractQuotedCipher(quotedMessage) {
  if (!quotedMessage) return '';
  const raw = String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      quotedMessage.documentMessage?.caption ||
      ''
  ).trim();
  if (raw.includes(DIVIDER)) {
    const parts = raw.split(DIVIDER);
    const tail = String(parts[parts.length - 1] || '').trim();
    if (tail) return tail;
  }
  return raw;
}

function buildAuditVerdict(decoded) {
  const res = decoded.residue || null;
  if (!res) return 'tidak diaudit';
  if (res.clean && decoded.syntaxValid) return 'Bersih 100% (0 sisa)';

  const parts = [];
  if (res.hexIdentifiers) parts.push(`${res.hexIdentifiers} _0x`);
  if (res.decoderCalls) parts.push(`${res.decoderCalls} decoder`);
  if (res.stringArrays) parts.push(`${res.stringArrays} string-array`);
  if (res.rotators) parts.push(`${res.rotators} rotator`);
  if (res.arrayIndexChains) parts.push(`${res.arrayIndexChains} index-chain`);
  if (res.base64Blobs) parts.push(`${res.base64Blobs} blob base64`);
  if (res.dynamicEval) parts.push(`${res.dynamicEval} eval/atob`);
  const detail = parts.length > 0 ? parts.join(', ') : 'obfuscation belum terurai';
  return `sisa ${res.score} (${detail})`;
}

module.exports = {
  name: 'decode',
  alias: ['dcode', 'dec', 'deobf', 'bukasandi'],
  category: 'tools',
  description: 'Dekripsi, deobfuscate, & rapikan (sempurnakan) kode script terenkripsi maupun sandi teks',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      msg,
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
      mode = args[0].toLowerCase();
      bodyCipher = rest;
    }

    let docInput = null;
    try {
      docInput = await extractScriptDocument(ctx);
    } catch (docErr) {
      await ctx.reply(formatError('Gagal Membaca File Script', [keep(docErr.message)]));
      return;
    }

    const finalInput = docInput ? docInput.content : bodyCipher || extractQuotedCipher(quotedMessage);
    if (!finalInput) {
      await ctx.reply(
        formatError('Dekripsi & Sempurnakan Script', [
          `File .js       : Reply file ${mono('script-enc.js')} lalu ketik ${mono(`${p}dcode`)}`,
          `Kode di chat   : Reply kode script yang ke-enkripsi lalu ketik ${mono(`${p}dcode`)}`,
          `Sandi teks     : Mendukung juga ${mono('Base64, Hex, Biner, Morse, ROT13')} otomatis!`,
        ])
      );
      return;
    }

    try {
      const decoded = decodeText(mode, finalInput, {
        fileName: docInput?.fileName || '',
      });

      // Cegah penyelundupan tautan grup/eksternal terlarang saat Antilink grup aktif
      if (isGroup && !senderIsOwner && !isAdmin) {
        const groupRow = ensureGroup(chatJid);
        if (groupRow?.antilink) {
          const badLink = await detectDisallowedLink(sock, chatJid, decoded.result, isBotAdmin, {
            allowDownloaderCmd: false,
          });
          if (badLink) {
            await ctx.reply(
              formatError('Tautan Tersembunyi Diblokir', [
                'Hasil decode mengandung tautan luar yang dilarang saat Antilink grup aktif.',
              ])
            );
            return;
          }
        }
      }

      // Kirim sebagai file .js rapi bila berasal dari dokumen atau ukuran kode > 1600 karakter
      if (docInput || (decoded.isScript && decoded.result.length > 1600)) {
        const outName = buildOutputFileName(docInput?.fileName || 'script.js', 'clean');
        const outBuf = Buffer.from(decoded.result, 'utf8');
        const caption = [
          `🔓 *${boldSans('SCRIPT DISEMPURNAKAN (DECODED)')}*`,
          DIVIDER,
          `• Mesin   : *${decoded.format}*`,
          decoded.layersUnpacked ? `• Layer   : *${decoded.layersUnpacked} lapis enkripsi dibuka*` : '',
          decoded.stringsRestored ? `• String  : *${decoded.stringsRestored} teks dipulihkan*` : '',
          decoded.identifiersRenamed ? `• Variabel: *${decoded.identifiersRenamed} nama _0x dirapikan*` : '',
          `• Ukuran  : *${(outBuf.length / 1024).toFixed(1)} KB*`,
          decoded.isScript ? `• Syntax  : *${decoded.syntaxValid ? 'Valid & Rapi' : 'Dicek Manual'}*` : '',
          decoded.isScript ? `• Audit   : *${buildAuditVerdict(decoded)}*` : '',
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

      const formattedBody = decoded.isScript
        ? `\`\`\`js\n${decoded.result.trim()}\n\`\`\``
        : decoded.result.slice(0, 2500);

      const out = [
        `🔓 *${boldSans(`HASIL DECODE (${decoded.format})`)}*`,
        DIVIDER,
        decoded.isScript ? keep(`Audit sisa obfuscation: *${buildAuditVerdict(decoded)}*`) : '',
        keep(formattedBody),
      ]
        .filter(Boolean)
        .join('\n');

      await ctx.reply(out);
    } catch (err) {
      logger.warn('CMD:DECODE', `Gagal decode: ${err.message}`);
      await ctx.reply(
        formatError('Gagal Mendekripsi Script', [
          keep(err.message),
        ])
      );
    }
  },
};
