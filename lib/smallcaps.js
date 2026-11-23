const config = require('../config');

/**
 * Tabel pemetaan a-z ke Unicode Small Caps:
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
const DIVIDER = '───────────────';

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
      '\\uFFF9[\\s\\S]*?\\uFFFB',
      '```[\\s\\S]*?```',
      '`[^`\\n]+`',
      'https?:\\/\\/[^\\s<>()]+',
      'www\\.[^\\s<>()]+',
      '\\b(?:discord\\.gg|chat\\.whatsapp\\.com)\\/[^\\s<>()]+',
      '\\b(?:[a-zA-Z0-9-]+\\.)+(?:id|com|net|org|gg|io|me|xyz|co|app|dev)(?::\\d+)?(?:\\/[^\\s<>()]*)?\\b',
      '@[A-Za-z0-9_.-]+',
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
 * Konversi teks tampilan ke SMALL CAPS Unicode dengan menjaga token penting
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
  for (const ch of stripKeepMarkers(String(text))) {
    const code = ch.codePointAt(0);
    if (code >= 65 && code <= 90) {
      out += String.fromCodePoint(0x1d5d4 + (code - 65));
    } else if (code >= 97 && code <= 122) {
      out += String.fromCodePoint(0x1d5ee + (code - 97));
    } else if (code >= 48 && code <= 57) {
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
 * Bersihkan judul & beri tepat 1 ikon aksen warna di depan judul saja (tidak ramai)
 */
function formatHeaderLine(rawTitle = '', { useBoldHeader = false, mood = 'info', icon = '' } = {}) {
  const cleaned = stripKeepMarkers(String(rawTitle || ''))
    .replace(/^[╭─│❖✦✿◦•\s]+/, '')
    .replace(/[\s❖✦✿♡🌸✨🛍️🔒💤🍓~]+$/u, '')
    .trim();

  const defaultIcon =
    icon ||
    (mood === 'success'
      ? '✅'
      : mood === 'warning'
      ? '⚠️'
      : mood === 'error'
      ? '❌'
      : '🌸');

  const hasLeadingEmoji =
    /^[\p{Extended_Pictographic}]/u.test(cleaned) && !/^[❖✦✿◦•♡]/.test(cleaned);
  const titleText = useBoldHeader ? boldSans(cleaned) : smallcaps(cleaned);

  return hasLeadingEmoji ? `*${titleText}*` : `${defaultIcon} *${titleText}*`;
}

/**
 * Rapikan satu baris isi kotak secara minimalis & tenang (pakai titik `•`, tanpa banjir emoji per baris)
 */
function formatBodyLine(rawLine = '') {
  const raw = stripKeepMarkers(String(rawLine ?? ''));
  const withoutPipe = raw.replace(/^\s*│\s?/, '');
  if (!withoutPipe.trim()) return { text: '', kind: 'blank' };

  // Pertahankan indentasi baris sub-output (misal "  › Output console")
  if (/^\s{2,}[›»>-]/.test(withoutPipe)) {
    return { text: `  ${withoutPipe.trim()}`, kind: 'sub' };
  }

  const trimmed = withoutPipe
    .trim()
    .replace(/[\s♡✿🌸✨~]+$/gu, '')
    .trim();

  // Deteksi simbol pembuka baris (✦, ◦, ❖, ✿, •, maupun dekorasi awal berlebih)
  const bulletMatch = /^([✦❖✿◦•])\s+([\s\S]+)$/.exec(trimmed);
  let bulletKind = 'primary';
  let bodyContent = trimmed;

  if (bulletMatch) {
    const sym = bulletMatch[1];
    bulletKind = sym === '◦' ? 'secondary' : 'primary';
    bodyContent = bulletMatch[2].trim();
  } else {
    // Jika baris diawali emoji dekoratif tunggal (misal ✨, 🎉, 🍓), rapikan agar tidak bertumpuk
    bodyContent = bodyContent.replace(/^(?:✨|🌸|🎀)\s+/u, '').trim();
  }

  const isNumberedList = /^\d+[.)]\s+/.test(bodyContent);
  const isSlotReel = bodyContent.startsWith('⟦');

  // Format pasangan "Label : Nilai" menjadi "• *ʟᴀʙᴇʟ* : Nilai" bersih tanpa emoji tambahan
  const kvMatch = /^([A-Za-zÀ-ÿ0-9 ()/_.-]{2,24}?)\s*:\s+([\s\S]+)$/.exec(bodyContent);
  if (kvMatch && !bodyContent.startsWith('http') && !isNumberedList) {
    const label = kvMatch[1].trim();
    const val = kvMatch[2].trim();
    return {
      text: `• *${smallcaps(label)}* : ${val}`,
      kind: 'kv',
    };
  }

  if (isNumberedList || isSlotReel || bodyContent.startsWith('`')) {
    return { text: bodyContent, kind: 'raw' };
  }

  // Baris petunjuk di bagian bawah ("Ketik ...", "Yuk ...", "Klaim ...") dibuat bersih tanpa titik agar lega
  if (
    bulletKind === 'secondary' &&
    /^(ketik|yuk|klaim|pastikan|gunakan|pilih|cek|lihat|hubungi|tunggu|tenang)\b/i.test(bodyContent)
  ) {
    return { text: bodyContent, kind: 'hint' };
  }

  return {
    text: bulletKind === 'secondary' ? `◦ ${bodyContent}` : `• ${bodyContent}`,
    kind: bulletKind,
  };
}

/**
 * Bangun kartu pesan WhatsApp yang bersih, tenang, tidak ramai emoji, & anti patah di HP:
 *
 * ⚠️ *sᴀʟᴅᴏ ᴛɪᴅᴀᴋ ᴄᴜᴋᴜᴘ*
 * ───────────────
 * • *ɪᴛᴇᴍ* : Latar Langit Bintang
 * • *ʜᴀʀɢᴀ* : 1.500 Sakura Coin
 * • *sᴀʟᴅᴏ* : 400 Sakura Coin (kurang 1.100 koin)
 *
 * Yuk kumpulkan koin lewat `.daily`, `.kerja`, atau `.quest`!
 */
function renderBox(title, lines = [], opts = {}) {
  const mood = opts.mood || 'info';
  const header = formatHeaderLine(title, {
    useBoldHeader: opts.useBoldHeader,
    mood,
    icon: opts.icon,
  });

  const rawList = Array.isArray(lines) ? lines : [lines];
  const parsed = [];

  for (const item of rawList) {
    if (item === null || item === undefined) continue;
    const res = formatBodyLine(item);
    if (res.kind === 'blank') {
      if (parsed.length > 0 && parsed[parsed.length - 1].kind !== 'blank') {
        parsed.push(res);
      }
      continue;
    }
    // Beri jarak 1 baris kosong otomatis sebelum kalimat petunjuk penutup agar rapi
    if (
      res.kind === 'hint' &&
      parsed.length > 0 &&
      parsed[parsed.length - 1].kind !== 'blank' &&
      parsed[parsed.length - 1].kind !== 'hint'
    ) {
      parsed.push({ text: '', kind: 'blank' });
    }
    parsed.push(res);
  }

  while (parsed.length > 0 && parsed[parsed.length - 1].kind === 'blank') {
    parsed.pop();
  }

  const out = [header, DIVIDER, ...parsed.map((p) => p.text)];
  return out.join('\n');
}

/**
 * Format pesan sukses (1 aksen ✅ di judul, isi bersih)
 */
function formatSuccess(title, details = []) {
  const arr = (Array.isArray(details) ? details : [details]).filter(Boolean);
  const lines = arr.map((line, idx) =>
    /^[✦◦❖✿•]/.test(String(line).trim()) ? line : `${idx === 0 ? '✦' : '◦'} ${line}`
  );
  return renderBox(title, lines, { mood: 'success' });
}

/**
 * Format pesan peringatan seperti Saldo Tidak Cukup (1 aksen ⚠️ di judul, isi bersih)
 */
function formatWarning(title, details = []) {
  const arr = (Array.isArray(details) ? details : [details]).filter(Boolean);
  const lines = arr.map((line, idx) =>
    /^[✦◦❖✿•]/.test(String(line).trim()) ? line : `${idx === 0 ? '✦' : '◦'} ${line}`
  );
  return renderBox(title, lines, { mood: 'warning' });
}

/**
 * Format pesan error (1 aksen ❌ di judul, isi bersih)
 */
function formatError(title, details = []) {
  const arr = (Array.isArray(details) ? details : [details]).filter(Boolean);
  const lines = arr.map((line, idx) =>
    /^[✦◦❖✿•]/.test(String(line).trim()) ? line : `${idx === 0 ? '✦' : '◦'} ${line}`
  );
  return renderBox(title, lines, { mood: 'error' });
}

module.exports = {
  SMALLCAPS_MAP,
  DIVIDER,
  keep,
  stripKeepMarkers,
  smallcapsPlain,
  smallcaps,
  boldSans,
  mono,
  renderBox,
  formatSuccess,
  formatWarning,
  formatError,
};
