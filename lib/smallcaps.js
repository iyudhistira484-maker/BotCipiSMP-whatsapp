const config = require('../config');

/**
 * Tabel pemetaan a-z ke Unicode Small Caps sesuai spesifikasi:
 * ᴀ ʙ ᴄ ᴅ ᴇ ꜰ ɢ ʜ ɪ ᴊ ᴋ ʟ ᴍ ɴ ᴏ ᴘ ǫ ʀ s ᴛ ᴜ ᴠ ᴡ x ʏ ᴢ
 */
const SMALLCAPS_MAP = Object.freeze({
  a: 'ᴀ',
  b: 'ʙ',
  c: 'ᴄ',
  d: 'ᴅ',
  e: 'ᴇ',
  f: 'ꜰ',
  g: 'ɢ',
  h: 'ʜ',
  i: 'ɪ',
  j: 'ᴊ',
  k: 'ᴋ',
  l: 'ʟ',
  m: 'ᴍ',
  n: 'ɴ',
  o: 'ᴏ',
  p: 'ᴘ',
  q: 'ǫ',
  r: 'ʀ',
  s: 's',
  t: 'ᴛ',
  u: 'ᴜ',
  v: 'ᴠ',
  w: 'ᴡ',
  x: 'x',
  y: 'ʏ',
  z: 'ᴢ',
});

const RAW_START = '\uFFF9';
const RAW_END = '\uFFFB';

/**
 * Bungkus teks (misalnya username pemain / kode unik) agar dilewati smallcaps()
 * @param {string|number} text
 * @returns {string}
 */
function keep(text) {
  if (text === null || text === undefined) return '';
  return `${RAW_START}${String(text)}${RAW_END}`;
}

/**
 * Hapus penanda keep() dari string jika masih ada
 * @param {string} text
 * @returns {string}
 */
function stripKeepMarkers(text) {
  return String(text || '').replace(/\uFFF9([\s\S]*?)\uFFFB/g, '$1');
}

/**
 * Konversi murni karakter a-z / A-Z ke small caps tanpa tokenisasi
 * @param {string} text
 * @returns {string}
 */
function smallcapsPlain(text) {
  if (text === null || text === undefined) return '';
  let out = '';
  const str = String(text);
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    const lower = ch.toLowerCase();
    out += SMALLCAPS_MAP[lower] || ch;
  }
  return out;
}

/**
 * Buat regex pencocok token yang TIDAK boleh diubah oleh smallcaps():
 * 1. Blok keep() eksplisit (\uFFF9...\uFFFB) -> untuk username / ID
 * 2. Blok kode / monospace (`...` atau ```...```)
 * 3. Link / URL (https://..., http://..., www..., discord.gg/..., domain/IP server)
 * 4. @mention (@628..., @username)
 * 5. Trigger command (misal .menu, .ping, .profil)
 */
function buildProtectedTokenRegex(prefix = '.') {
  const escapedPrefix = String(prefix || '.').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    [
      // 1. Penanda keep() eksplisit
      '\\uFFF9[\\s\\S]*?\\uFFFB',
      // 2. Triple backtick & single backtick monospace
      '```[\\s\\S]*?```',
      '`[^`\\n]+`',
      // 3. URL lengkap atau domain populer (termasuk IP server MC seperti play.cipismp.my.id)
      'https?:\\/\\/[^\\s<>()]+',
      'www\\.[^\\s<>()]+',
      '\\b(?:discord\\.gg|chat\\.whatsapp\\.com)\\/[^\\s<>()]+',
      '\\b(?:[a-zA-Z0-9-]+\\.)+(?:id|com|net|org|gg|io|me|xyz|co|app|dev)(?::\\d+)?(?:\\/[^\\s<>()]*)?\\b',
      // 4. @mention nomor / username
      '@[A-Za-z0-9_.-]+',
      // 5. Trigger command setelah awal baris / spasi / pembuka kurung
      `(?<=^|[\\s(\\[{"'│•◦✦❖✿➤-])${escapedPrefix}[a-zA-Z][a-zA-Z0-9_-]*`,
    ].join('|'),
    'g'
  );
}

let cachedPrefix = null;
let cachedRegex = null;

function getProtectedRegex(customPrefix) {
  const activePrefix = customPrefix || config.prefix || '.';
  if (cachedRegex && cachedPrefix === activePrefix) {
    return cachedRegex;
  }
  cachedPrefix = activePrefix;
  cachedRegex = buildProtectedTokenRegex(activePrefix);
  return cachedRegex;
}

/**
 * Konversi teks tampilan ke SMALL CAPS Unicode, otomatis menjaga:
 * - trigger command (.menu, .ping, dll.)
 * - angka
 * - link / URL / host server
 * - username yang dibungkus keep()
 * - @mention (@user / @628xxx)
 * - teks monospace (`...`)
 *
 * @param {string} text
 * @param {{ prefix?: string }} [options]
 * @returns {string}
 */
function smallcaps(text, options = {}) {
  if (text === null || text === undefined) return '';
  const input = String(text);
  if (!input) return '';

  const regex = getProtectedRegex(options.prefix);
  regex.lastIndex = 0;

  let result = '';
  let lastIndex = 0;
  let match = regex.exec(input);

  while (match !== null) {
    if (match.index > lastIndex) {
      result += smallcapsPlain(input.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith(RAW_START) && token.endsWith(RAW_END)) {
      result += token.slice(1, -1);
    } else {
      result += token;
    }
    lastIndex = match.index + token.length;
    match = regex.exec(input);
  }

  if (lastIndex < input.length) {
    result += smallcapsPlain(input.slice(lastIndex));
  }

  return result;
}

/**
 * Konversi teks ke Mathematical Sans-Serif Bold (𝗕𝗼𝗹𝗱) untuk header besar
 * @param {string} text
 * @returns {string}
 */
function boldSans(text) {
  if (text === null || text === undefined) return '';
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code >= 65 && code <= 90) {
      // A-Z -> U+1D5D4
      out += String.fromCodePoint(0x1d5d4 + (code - 65));
    } else if (code >= 97 && code <= 122) {
      // a-z -> U+1D5EE
      out += String.fromCodePoint(0x1d5ee + (code - 97));
    } else if (code >= 48 && code <= 57) {
      // 0-9 -> U+1D7EC
      out += String.fromCodePoint(0x1d7ec + (code - 48));
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Format contoh command menjadi monospace WhatsApp
 * @param {string} cmdText
 * @returns {string}
 */
function mono(cmdText) {
  return `\`${String(cmdText || '').trim()}\``;
}

/**
 * Bangun kerangka kotak kawaii seragam:
 * ╭─❖ ᴍᴇɴᴜ ᴜᴛᴀᴍᴀ ❖
 * │ ✦ ʜᴀʟᴏ, @user
 * ╰────────────
 *
 * @param {string} title
 * @param {string[]} lines
 * @param {{ footer?: string, useBoldHeader?: boolean }} [opts]
 * @returns {string}
 */
function renderBox(title, lines = [], opts = {}) {
  const headerText = opts.useBoldHeader ? boldSans(title) : smallcaps(title);
  const bodyLines = (Array.isArray(lines) ? lines : [lines])
    .filter((line) => line !== null && line !== undefined)
    .map((line) => {
      const str = String(line);
      if (!str.trim()) return '│';
      const converted = smallcaps(str);
      return converted.startsWith('│') ? converted : `│ ${converted}`;
    });

  const out = [`╭─❖ ${headerText} ❖`, ...bodyLines];
  if (opts.footer) {
    out.push(`│ ◦ ${smallcaps(opts.footer)}`);
  }
  out.push('╰────────────');
  return out.join('\n');
}

/**
 * Format pesan sukses seragam & imut
 * @param {string} title
 * @param {string|string[]} details
 * @returns {string}
 */
function formatSuccess(title, details = []) {
  const arr = Array.isArray(details) ? details : [details];
  const lines = arr.map((line, idx) => `${idx === 0 ? '✦' : '◦'} ${line}`);
  return renderBox(`✿ ${title}`, lines, { footer: 'ʏᴇᴀʏ! ʙᴇʀʜᴀsɪʟ ᴅɪᴘʀᴏsᴇs ♡' });
}

/**
 * Format pesan error seragam & imut
 * @param {string} title
 * @param {string|string[]} details
 * @returns {string}
 */
function formatError(title, details = []) {
  const arr = Array.isArray(details) ? details : [details];
  const lines = arr.map((line, idx) => `${idx === 0 ? '✦' : '◦'} ${line}`);
  return renderBox(`✿ ${title}`, lines, { footer: 'ᴊᴀɴɢᴀɴ sᴇᴅɪʜ, ᴄᴏʙᴀ ʟᴀɢɪ ʏᴀ ♡' });
}

module.exports = {
  SMALLCAPS_MAP,
  keep,
  stripKeepMarkers,
  smallcapsPlain,
  smallcaps,
  boldSans,
  mono,
  renderBox,
  formatSuccess,
  formatError,
};
