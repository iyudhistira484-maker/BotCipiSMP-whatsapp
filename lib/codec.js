const crypto = require('crypto');

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
  auto: 'Auto-Detect',
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

function encodeText(modeRaw = 'base64', rawInput = '') {
  const mode = String(modeRaw || 'base64').toLowerCase().trim();
  const input = String(rawInput || '').slice(0, 1200);
  if (!input) {
    throw new Error('Teks yang ingin di-encode masih kosong.');
  }

  switch (mode) {
    case 'base64':
    case 'b64':
      return {
        format: 'Base64',
        result: Buffer.from(input, 'utf8').toString('base64'),
      };
    case 'hex':
      return {
        format: 'Hexadecimal',
        result: Buffer.from(input, 'utf8').toString('hex'),
      };
    case 'bin':
    case 'biner':
    case 'binary': {
      const bytes = Buffer.from(input.slice(0, 280), 'utf8');
      const bits = [...bytes].map((b) => b.toString(2).padStart(8, '0')).join(' ');
      return {
        format: 'Binary (8-bit)',
        result: bits,
      };
    }
    case 'morse': {
      const out = encodeToMorse(input);
      if (!out) throw new Error('Teks tidak mengandung huruf atau angka yang valid untuk Sandi Morse.');
      return {
        format: 'Sandi Morse',
        result: out,
      };
    }
    case 'rot13':
      return {
        format: 'ROT13 Cipher',
        result: rot13Transform(input),
      };
    case 'url':
      return {
        format: 'URL Encode',
        result: encodeURIComponent(input),
      };
    case 'balik':
    case 'reverse':
      return {
        format: 'Balik Teks',
        result: [...input].reverse().join(''),
      };
    case 'md5':
      return {
        format: 'MD5 Hash (1 Arah)',
        result: crypto.createHash('md5').update(input, 'utf8').digest('hex'),
      };
    case 'sha256':
      return {
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
  if (bitsOnly.length < 8 || bitsOnly.length % 8 !== 0 || bitsOnly.length > 16000) return null;
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
  if (clean.length < 4 || clean.length % 2 !== 0 || clean.length > 8000) return null;
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
  const out = Buffer.from(clean, 'hex').toString('utf8');
  return isMostlyPrintableUtf8(out) ? out : null;
}

function tryDecodeBase64(raw = '') {
  const clean = String(raw || '').trim().replace(/\s+/g, '');
  if (clean.length < 4 || clean.length > 8000) return null;
  // Normalisasi URL-safe base64 ke standar
  const std = clean.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(std)) return null;
  const padded = std.padEnd(Math.ceil(std.length / 4) * 4, '=');
  const buf = Buffer.from(padded, 'base64');
  if (buf.length === 0) return null;
  // Pastikan benar-benar round-trip base64 yang sah
  const reEncoded = buf.toString('base64').replace(/=+$/, '');
  if (reEncoded !== padded.replace(/=+$/, '')) return null;
  const out = buf.toString('utf8');
  return isMostlyPrintableUtf8(out) ? out : null;
}

function decodeText(modeRaw = 'auto', rawInput = '') {
  const mode = String(modeRaw || 'auto').toLowerCase().trim();
  const input = String(rawInput || '').trim().slice(0, 6000);
  if (!input) {
    throw new Error('Sandi/kode yang ingin di-decode masih kosong.');
  }

  switch (mode) {
    case 'bin':
    case 'biner':
    case 'binary': {
      const out = tryDecodeBinary(input);
      if (!out) throw new Error('Input bukan kode biner 8-bit yang valid.');
      return { format: 'Binary (8-bit)', result: out };
    }
    case 'morse': {
      const out = decodeFromMorse(input);
      if (!out) throw new Error('Input bukan Sandi Morse yang valid.');
      return { format: 'Sandi Morse', result: out };
    }
    case 'hex': {
      const out = tryDecodeHex(input);
      if (!out) throw new Error('Input bukan kode Hexadecimal teks UTF-8 yang valid.');
      return { format: 'Hexadecimal', result: out };
    }
    case 'base64':
    case 'b64': {
      const out = tryDecodeBase64(input);
      if (!out) throw new Error('Input bukan kode Base64 teks UTF-8 yang valid.');
      return { format: 'Base64', result: out };
    }
    case 'url': {
      try {
        return { format: 'URL Decode', result: decodeURIComponent(input.replace(/\+/g, ' ')) };
      } catch {
        throw new Error('Format URL-encoded tidak valid.');
      }
    }
    case 'rot13':
      return { format: 'ROT13 Cipher', result: rot13Transform(input) };
    case 'balik':
    case 'reverse':
      return { format: 'Balik Teks', result: [...input].reverse().join('') };
    case 'auto': {
      const binOut = tryDecodeBinary(input);
      if (binOut) return { format: 'Binary (Auto)', result: binOut };

      const morseOut = tryDecodeMorse(input);
      if (morseOut) return { format: 'Sandi Morse (Auto)', result: morseOut };

      // Jika murni karakter hex (dan tidak mengandung huruf g-z atau +/=), prioritaskan Hex dulu
      const hexOut = tryDecodeHex(input);
      if (hexOut) return { format: 'Hexadecimal (Auto)', result: hexOut };

      const b64Out = tryDecodeBase64(input);
      if (b64Out) return { format: 'Base64 (Auto)', result: b64Out };

      if (/%[0-9A-Fa-f]{2}/.test(input)) {
        try {
          return { format: 'URL Decode (Auto)', result: decodeURIComponent(input) };
        } catch {
          // Lanjut
        }
      }

      throw new Error(
        'Format sandi tidak terdeteksi otomatis. Sebutkan formatnya (misal: b64, hex, biner, morse, rot13, atau balik).'
      );
    }
    default:
      throw new Error(`Format decode "${mode}" tidak dikenali.`);
  }
}

module.exports = {
  ENCODE_MODES,
  DECODE_MODES,
  encodeText,
  decodeText,
};
