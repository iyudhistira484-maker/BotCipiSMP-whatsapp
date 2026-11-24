const crypto = require('crypto');
const path = require('path');
const { unwrapMessageContent } = require('./buttons');
const { downloadMediaBuffer } = require('./sticker');
const {
  looksLikeJavaScript,
  obfuscateJavaScript,
  deobfuscateAndBeautifyJavaScript,
} = require('./script-codec');

const MORSE_MAP = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--',
  '-': '-....-', '/': '-..-.', '@': '.--.-.', '(': '-.--.', ')': '-.--.-',
});

const REVERSE_MORSE_MAP = Object.freeze(
  Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]))
);

const ENCODE_MODES = Object.freeze({
  js: 'JS Obfuscator (_0x + XOR)',
  obf: 'JS Obfuscator (_0x + XOR)',
  hard: 'JS Obfuscator (_0x + XOR)',
  pack: 'JS Packed Container (Zlib + XOR)',
  eval: 'JS Packed Container (Zlib + XOR)',
  base64: 'Base64',
  b64: 'Base64',
  hex: 'Hexadecimal',
  bin: 'Binary (8-bit)',
  biner: 'Binary (8-bit)',
  binary: 'Binary (8-bit)',
  morse: 'Sandi Morse',
  rot13: 'ROT13 Cipher',
  url: 'URL Encode',
  balik: 'Balik Teks',
  reverse: 'Balik Teks',
  md5: 'MD5 Hash (1 Arah)',
  sha256: 'SHA-256 Hash (1 Arah)',
});

const DECODE_MODES = Object.freeze({
  auto: 'Auto-Detect (Script & Sandi)',
  js: 'Deobfuscate & Beautify JS',
  deobf: 'Deobfuscate & Beautify JS',
  rapikan: 'Deobfuscate & Beautify JS',
  beautify: 'Deobfuscate & Beautify JS',
  base64: 'Base64',
  b64: 'Base64',
  hex: 'Hexadecimal',
  bin: 'Binary (8-bit)',
  biner: 'Binary (8-bit)',
  binary: 'Binary (8-bit)',
  morse: 'Sandi Morse',
  rot13: 'ROT13 Cipher',
  url: 'URL Decode',
  balik: 'Balik Teks',
  reverse: 'Balik Teks',
});

const MAX_SCRIPT_DOC_BYTES = 2 * 1024 * 1024; // Maks 2 MB untuk dokumen script

function stripMarkdownCodeFence(raw = '') {
  const trimmed = String(raw || '').trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Ekstrak dokumen file script (.js/.mjs/.cjs/.ts/.json/.txt) dari pesan langsung atau reply
 */
async function extractScriptDocument(ctx) {
  const { sock, msg, quotedMessage, contextInfo } = ctx;
  const direct = unwrapMessageContent(msg?.message);

  let docMsg = null;
  let stanzaKey = null;
  if (direct?.documentMessage) {
    docMsg = direct.documentMessage;
    stanzaKey = msg?.key;
  } else if (direct?.documentWithCaptionMessage?.message?.documentMessage) {
    docMsg = direct.documentWithCaptionMessage.message.documentMessage;
    stanzaKey = msg?.key;
  } else if (quotedMessage?.documentMessage) {
    docMsg = quotedMessage.documentMessage;
    stanzaKey = {
      remoteJid: msg?.key?.remoteJid,
      id: contextInfo?.stanzaId || 'QUOTED_DOC',
      participant: contextInfo?.participant || undefined,
    };
  } else if (quotedMessage?.documentWithCaptionMessage?.message?.documentMessage) {
    docMsg = quotedMessage.documentWithCaptionMessage.message.documentMessage;
    stanzaKey = {
      remoteJid: msg?.key?.remoteJid,
      id: contextInfo?.stanzaId || 'QUOTED_DOC',
      participant: contextInfo?.participant || undefined,
    };
  }

  if (!docMsg) return null;

  const fileName = String(docMsg.fileName || docMsg.title || 'script.js').trim();
  const mime = String(docMsg.mimetype || '').toLowerCase();
  const bytes = Number(docMsg.fileLength || 0);

  if (bytes > MAX_SCRIPT_DOC_BYTES) {
    throw new Error('Ukuran file script terlalu besar (maksimal 2 MB).');
  }

  const isSupportedExt = /\.(?:m?js|cjs|ts|jsx|tsx|json|txt)$/i.test(fileName);
  const isTextMime = /^(?:text\/|application\/(?:javascript|x-javascript|ecmascript|json))/i.test(mime);
  if (!isSupportedExt && !isTextMime && mime && mime !== 'application/octet-stream') {
    throw new Error(`Tipe file "${fileName}" bukan file kode/teks (.js, .mjs, .cjs, .json, .txt).`);
  }

  // Dukungan buffer simulasi pada unit test offline maupun unduhan Baileys asli di VPS
  let buf = null;
  if (Buffer.isBuffer(docMsg._mockBuffer)) {
    buf = docMsg._mockBuffer;
  } else {
    buf = await downloadMediaBuffer(sock, {
      bytes,
      downloadTarget: {
        key: stanzaKey,
        message: { documentMessage: docMsg },
      },
    });
  }

  if (!buf || buf.length === 0) {
    throw new Error('File script kosong atau gagal diunduh.');
  }
  if (buf.length > MAX_SCRIPT_DOC_BYTES) {
    throw new Error('Ukuran file script melebihi batas 2 MB.');
  }

  const base = path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, '_') || 'script.js';
  return {
    content: buf.toString('utf8'),
    fileName: base,
  };
}

function buildOutputFileName(originalName = 'script.js', suffix = 'decoded') {
  const parsed = path.parse(originalName || 'script.js');
  const cleanBase = (parsed.name || 'script')
    .replace(/-(?:enc|obf|encrypted|decoded|clean|deobf)$/i, '')
    .slice(0, 48);
  const ext = parsed.ext && /^\.(?:m?js|cjs|ts|json|txt)$/i.test(parsed.ext) ? parsed.ext : '.js';
  return `${cleanBase}-${suffix}${ext}`;
}

function rot13Transform(input = '') {
  return String(input).replace(/[A-Za-z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function encodeToMorse(input = '') {
  const words = String(input)
    .toUpperCase()
    .trim()
    .split(/\s+/);
  return words
    .map((word) =>
      [...word]
        .map((ch) => MORSE_MAP[ch] || '')
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' / ');
}

function decodeFromMorse(input = '') {
  const cleaned = String(input).trim();
  if (!cleaned) return '';
  const wordGroups = cleaned.split(/\s*\/\s*|\s{3,}/);
  return wordGroups
    .map((wg) =>
      wg
        .trim()
        .split(/\s+/)
        .map((code) => REVERSE_MORSE_MAP[code] || '')
        .join('')
    )
    .filter(Boolean)
    .join(' ');
}

function isMostlyPrintableUtf8(str = '') {
  if (!str || str.includes('\uFFFD')) return false;
  let printable = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable += 1;
    }
  }
  return printable / str.length >= 0.92;
}

function encodeText(modeRaw = 'auto', rawInput = '', opts = {}) {
  let mode = String(modeRaw || 'auto').toLowerCase().trim();
  const cleanedInput = stripMarkdownCodeFence(rawInput);
  if (!cleanedInput) {
    throw new Error('Kode script atau teks yang ingin di-encode masih kosong.');
  }

  // Jika mode = 'auto', otomatis pilih JS Obfuscator bila input berupa file .js atau kode JavaScript!
  if (mode === 'auto') {
    mode = looksLikeJavaScript(cleanedInput, opts.fileName) ? 'hard' : 'base64';
  }

  if (mode === 'js' || mode === 'obf' || mode === 'hard' || mode === 'pack' || mode === 'eval') {
    const obf = obfuscateJavaScript(cleanedInput, {
      mode: mode === 'pack' || mode === 'eval' ? 'pack' : 'hard',
    });
    return {
      isScript: true,
      format: obf.format,
      result: obf.code,
      syntaxValid: obf.syntaxValid,
      stringsEncrypted: obf.stringsEncrypted || 0,
    };
  }

  const input = cleanedInput.slice(0, 4000);
  switch (mode) {
    case 'base64':
    case 'b64':
      return { isScript: false, format: 'Base64', result: Buffer.from(input, 'utf8').toString('base64') };
    case 'hex':
      return { isScript: false, format: 'Hexadecimal', result: Buffer.from(input, 'utf8').toString('hex') };
    case 'bin':
    case 'biner':
    case 'binary': {
      const bytes = Buffer.from(input.slice(0, 320), 'utf8');
      const bits = [...bytes].map((b) => b.toString(2).padStart(8, '0')).join(' ');
      return { isScript: false, format: 'Binary (8-bit)', result: bits };
    }
    case 'morse': {
      const out = encodeToMorse(input);
      if (!out) throw new Error('Teks tidak mengandung huruf atau angka yang valid untuk Sandi Morse.');
      return { isScript: false, format: 'Sandi Morse', result: out };
    }
    case 'rot13':
      return { isScript: false, format: 'ROT13 Cipher', result: rot13Transform(input) };
    case 'url':
      return { isScript: false, format: 'URL Encode', result: encodeURIComponent(input) };
    case 'balik':
    case 'reverse':
      return { isScript: false, format: 'Balik Teks', result: [...input].reverse().join('') };
    case 'md5':
      return {
        isScript: false,
        format: 'MD5 Hash (1 Arah)',
        result: crypto.createHash('md5').update(input, 'utf8').digest('hex'),
      };
    case 'sha256':
      return {
        isScript: false,
        format: 'SHA-256 Hash (1 Arah)',
        result: crypto.createHash('sha256').update(input, 'utf8').digest('hex'),
      };
    default:
      throw new Error(`Format encode "${mode}" tidak dikenali.`);
  }
}

function tryDecodeBinary(raw = '') {
  const compact = String(raw || '').trim();
  if (!/^[01\s]+$/.test(compact)) return null;
  const bitsOnly = compact.replace(/\s+/g, '');
  if (bitsOnly.length < 8 || bitsOnly.length % 8 !== 0 || bitsOnly.length > 64000) return null;
  const bytes = [];
  for (let i = 0; i < bitsOnly.length; i += 8) {
    bytes.push(parseInt(bitsOnly.slice(i, i + 8), 2));
  }
  const out = Buffer.from(bytes).toString('utf8');
  return isMostlyPrintableUtf8(out) ? out : null;
}

function tryDecodeMorse(raw = '') {
  const compact = String(raw || '').trim();
  if (!/^[.\-/\s]+$/.test(compact) || !/[.\-]/.test(compact)) return null;
  const tokens = compact.split(/\s+/).filter((t) => t !== '/');
  if (tokens.length === 0 || !tokens.every((t) => Boolean(REVERSE_MORSE_MAP[t]))) return null;
  const out = decodeFromMorse(compact);
  return out ? out : null;
}

function tryDecodeHex(raw = '') {
  const clean = String(raw || '').trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean.length < 4 || clean.length % 2 !== 0 || clean.length > 200000) return null;
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  const out = Buffer.from(clean, 'hex').toString('utf8');
  return isMostlyPrintableUtf8(out) ? out : null;
}

function tryDecodeBase64(raw = '') {
  const clean = String(raw || '').trim().replace(/\s+/g, '');
  if (clean.length < 4 || clean.length > 400000) return null;
  const std = clean.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(std)) return null;
  const padded = std.padEnd(Math.ceil(std.length / 4) * 4, '=');
  const buf = Buffer.from(padded, 'base64');
  if (buf.length === 0) return null;
  const reEncoded = buf.toString('base64').replace(/=+$/, '');
  if (reEncoded !== padded.replace(/=+$/, '')) return null;
  const out = buf.toString('utf8');
  return isMostlyPrintableUtf8(out) ? out : null;
}

/**
 * Decode otomatis baik Script JS Terenkripsi/Obfuscated maupun Sandi Teks (Base64/Hex/Biner/Morse)
 */
function decodeText(modeRaw = 'auto', rawInput = '', opts = {}) {
  const mode = String(modeRaw || 'auto').toLowerCase().trim();
  const input = stripMarkdownCodeFence(rawInput);
  if (!input) {
    throw new Error('Kode script atau sandi yang ingin di-decode masih kosong.');
  }

  // Mode eksplisit Deobfuscate & Beautify Script JS
  if (mode === 'js' || mode === 'deobf' || mode === 'rapikan' || mode === 'beautify') {
    // Jika file awalnya di-encode Base64/Hex utuh, buka dulu lapisan Base64/Hex-nya lalu deobfuscate JS!
    const preDecoded = tryDecodeBase64(input) || tryDecodeHex(input) || input;
    const dec = deobfuscateAndBeautifyJavaScript(preDecoded);
    return {
      isScript: true,
      format: `JS Deobfuscated (${dec.techniques.join(' + ')})`,
      result: dec.code,
      layersUnpacked: dec.layersUnpacked,
      stringsRestored: dec.stringsRestored,
      syntaxValid: dec.syntaxValid,
    };
  }

  switch (mode) {
    case 'bin':
    case 'biner':
    case 'binary': {
      const out = tryDecodeBinary(input);
      if (!out) throw new Error('Input bukan kode biner 8-bit yang valid.');
      return { isScript: false, format: 'Binary (8-bit)', result: out };
    }
    case 'morse': {
      const out = decodeFromMorse(input);
      if (!out) throw new Error('Input bukan Sandi Morse yang valid.');
      return { isScript: false, format: 'Sandi Morse', result: out };
    }
    case 'hex': {
      const out = tryDecodeHex(input);
      if (!out) throw new Error('Input bukan kode Hexadecimal UTF-8 yang valid.');
      return { isScript: false, format: 'Hexadecimal', result: out };
    }
    case 'base64':
    case 'b64': {
      const out = tryDecodeBase64(input);
      if (!out) throw new Error('Input bukan kode Base64 UTF-8 yang valid.');
      return { isScript: false, format: 'Base64', result: out };
    }
    case 'url': {
      try {
        return { isScript: false, format: 'URL Decode', result: decodeURIComponent(input.replace(/\+/g, ' ')) };
      } catch {
        throw new Error('Format URL-encoded tidak valid.');
      }
    }
    case 'rot13':
      return { isScript: false, format: 'ROT13 Cipher', result: rot13Transform(input) };
    case 'balik':
    case 'reverse':
      return { isScript: false, format: 'Balik Teks', result: [...input].reverse().join('') };
    case 'auto': {
      // 1. Jika input langsung berupa kode JavaScript (atau file .js), jalankan Deobfuscator + Beautifier penuh!
      if (looksLikeJavaScript(input, opts.fileName)) {
        const dec = deobfuscateAndBeautifyJavaScript(input);
        return {
          isScript: true,
          format: `JS Deobfuscator (${dec.techniques.join(' + ')})`,
          result: dec.code,
          layersUnpacked: dec.layersUnpacked,
          stringsRestored: dec.stringsRestored,
          syntaxValid: dec.syntaxValid,
        };
      }

      // 2. Cek sandi Biner / Morse / Hex / Base64 — dan bila isinya ternyata kode JS, lanjutkan Deobfuscate & Beautify otomatis!
      const maybeFinishOrDeobf = (plainLabel, plainText) => {
        if (looksLikeJavaScript(plainText, opts.fileName)) {
          const dec = deobfuscateAndBeautifyJavaScript(plainText);
          return {
            isScript: true,
            format: `${plainLabel} -> JS Deobfuscator`,
            result: dec.code,
            layersUnpacked: dec.layersUnpacked + 1,
            stringsRestored: dec.stringsRestored,
            syntaxValid: dec.syntaxValid,
          };
        }
        return { isScript: false, format: `${plainLabel} (Auto)`, result: plainText };
      };

      const binOut = tryDecodeBinary(input);
      if (binOut) return maybeFinishOrDeobf('Binary', binOut);

      const morseOut = tryDecodeMorse(input);
      if (morseOut) return { isScript: false, format: 'Sandi Morse (Auto)', result: morseOut };

      const hexOut = tryDecodeHex(input);
      if (hexOut) return maybeFinishOrDeobf('Hexadecimal', hexOut);

      const b64Out = tryDecodeBase64(input);
      if (b64Out) return maybeFinishOrDeobf('Base64', b64Out);

      if (/%[0-9A-Fa-f]{2}/.test(input)) {
        try {
          return maybeFinishOrDeobf('URL Decode', decodeURIComponent(input));
        } catch {
          // Lanjut
        }
      }

      throw new Error(
        'Input tidak dikenali sebagai script JS terenkripsi maupun sandi (Base64/Hex/Biner/Morse). Kirim/reply file .js atau blok kode script.'
      );
    }
    default:
      throw new Error(`Format decode "${mode}" tidak dikenali.`);
  }
}

module.exports = {
  ENCODE_MODES,
  DECODE_MODES,
  extractScriptDocument,
  buildOutputFileName,
  encodeText,
  decodeText,
};
