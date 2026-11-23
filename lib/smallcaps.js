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
const DIVIDER = '━━━━━━━━━━━━━━━━━━';

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
 * Pilih ikon warna kontekstual berdasarkan nama field / isi kalimat agar chat hidup & berwarna
 */
function inferLineEmoji(content = '', bulletKind = 'primary', mood = 'info') {
  const lower = content.toLowerCase();

  if (/^(ketik|contoh|tips|yuk|pastikan|gunakan|pilih|cara|silakan|balas pesan)\b/.test(lower)) {
    return '💡';
  }
  if (/^(harga|biaya|taruhan|nominal|ongkos|kurang)\b/.test(lower)) {
    return '🪙';
  }
  if (/^(saldo|sisa saldo|dompet|hadiah|bonus|reward|total koin)\b/.test(lower)) {
    return '💰';
  }
  if (/^(nama|user|pengirim|penerima|target|pemain|oleh|admin|pemilik)\b/.test(lower)) {
    return '👤';
  }
  if (/^(grup|anggota|peserta|member|kuota)\b/.test(lower)) {
    return '👥';
  }
  if (/^(waktu|jadwal|durasi|uptime|tanggal|batas|sisa|reset|dibuat)\b/.test(lower)) {
    return '⏱️';
  }
  if (/^(server|minecraft|command|jalur|output|host|port|ip|versi|tps|akun)\b/.test(lower)) {
    return '⛏️';
  }
  if (/^(whatsapp)\b/.test(lower)) {
    return '💬';
  }
  if (/^(discord)\b/.test(lower)) {
    return '🌐';
  }
  if (/^(level|xp|rank|peringkat|rarity|pity|shards|koleksi|karakter|item)\b/.test(lower)) {
    return '⭐';
  }
  if (/^(tiket|kode|id|kategori|subjek|status|alasan|detail)\b/.test(lower)) {
    return '🏷️';
  }

  if (bulletKind === 'secondary') return '▫️';
  if (mood === 'success') return '✨';
  if (mood === 'warning') return '🔸';
  if (mood === 'error') return '🔸';
  return '🔹';
}

/**
 * Bersihkan simbol monokrom di awal judul & tambahkan badge warna sesuai mood
 */
function formatHeaderLine(rawTitle = '', { useBoldHeader = false, mood = 'info', icon = '' } = {}) {
  const cleaned = stripKeepMarkers(String(rawTitle || ''))
    .replace(/^[╭─│❖✦✿◦•\s]+/, '')
    .replace(/[❖✦✿♡\s]+$/, '')
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

  // Cek apakah judul sudah diawali emoji berwarna asli (mis. 🎉, ✂️, 🎊, 🍃)
  const hasLeadingColorEmoji = /^[\p{Extended_Pictographic}]/u.test(cleaned) && !/^[❖✦✿◦•♡]/.test(cleaned);
  const titleText = useBoldHeader ? boldSans(cleaned) : smallcaps(cleaned);

  return hasLeadingColorEmoji ? `*${titleText}*` : `${defaultIcon} *${titleText}*`;
}

/**
 * Rapikan satu baris isi kotak tanpa garis vertikal `│` agar tidak patah di layar HP
 */
function formatBodyLine(rawLine = '', mood = 'info') {
  const raw = stripKeepMarkers(String(rawLine ?? ''));
  const withoutPipe = raw.replace(/^\s*│\s?/, '');
  if (!withoutPipe.trim()) return '';

  // Pertahankan indentasi baris sub-output (misal "  › Output console")
  if (/^\s{2,}[›»>-]/.test(withoutPipe)) {
    return `  ${withoutPipe.trim()}`;
  }

  const trimmed = withoutPipe.trim()
    .replace(/\s*♡\s*$/g, '')
    .replace(/\s*✿\s*$/g, '')
    .trim();

  // Deteksi bullet monokrom lama (✦, ◦, ❖, ✿, •)
  const monoBulletMatch = /^([✦❖✿◦•])\s+([\s\S]+)$/.exec(trimmed);
  let bulletKind = null;
  let bodyContent = trimmed;

  if (monoBulletMatch) {
    const sym = monoBulletMatch[1];
    bulletKind = sym === '◦' || sym === '•' ? 'secondary' : 'primary';
    bodyContent = monoBulletMatch[2].trim();
  }

  const alreadyHasEmoji =
    /^[\p{Extended_Pictographic}]/u.test(bodyContent) && !/^[❖✦✿◦•♡]/.test(bodyContent);
  const isNumberedList = /^\d+[.)]\s+/.test(bodyContent);

  // Format pasangan "Label : Nilai" agar rapi & kontras tebal
  const kvMatch = /^([A-Za-zÀ-ÿ0-9 ()/_.-]{2,24}?)\s*:\s+([\s\S]+)$/.exec(bodyContent);
  if (kvMatch && !bodyContent.startsWith('http') && !isNumberedList) {
    const label = kvMatch[1].trim();
    const val = kvMatch[2].trim();
    const emoji = alreadyHasEmoji ? '' : `${inferLineEmoji(label, bulletKind || 'primary', mood)} `;
    return `${emoji}*${smallcaps(label)}* : ${val}`;
  }

  if (alreadyHasEmoji || isNumberedList || bodyContent.startsWith('⟦') || bodyContent.startsWith('`')) {
    return bodyContent;
  }

  if (bulletKind) {
    const emoji = inferLineEmoji(bodyContent, bulletKind, mood);
    return `${emoji} ${bodyContent}`;
  }

  const fallbackEmoji = inferLineEmoji(bodyContent, 'primary', mood);
  return `${fallbackEmoji} ${bodyContent}`;
}

/**
 * Bangun kartu pesan WhatsApp yang rapi, bersih tanpa garis samping patah, & berwarna:
 *
 * 🌸 *ᴊᴜᴅᴜʟ ᴘᴇsᴀɴ*
 * ━━━━━━━━━━━━━━━━━━
 * 🔹 *ʟᴀʙᴇʟ* : Nilai bersih mudah dibaca
 * 💡 Tips pemakaian command `.menu`
 * ━━━━━━━━━━━━━━━━━━
 * ✨ _CipiSMP Official_
 *
 * @param {string} title
 * @param {string[]} lines
 * @param {{ footer?: string, useBoldHeader?: boolean, mood?: 'info'|'success'|'warning'|'error', icon?: string }} [opts]
 * @returns {string}
 */
function renderBox(title, lines = [], opts = {}) {
  const mood = opts.mood || 'info';
  const header = formatHeaderLine(title, {
    useBoldHeader: opts.useBoldHeader,
    mood,
    icon: opts.icon,
  });

  const rawList = Array.isArray(lines) ? lines : [lines];
  const formattedLines = [];
  let prevBlank = false;

  for (const item of rawList) {
    if (item === null || item === undefined) continue;
    const formatted = formatBodyLine(item, mood);
    if (!formatted) {
      if (!prevBlank && formattedLines.length > 0) {
        formattedLines.push('');
        prevBlank = true;
      }
      continue;
    }
    formattedLines.push(formatted);
    prevBlank = false;
  }

  while (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] === '') {
    formattedLines.pop();
  }

  const out = [header, DIVIDER, ...formattedLines];

  if (opts.footer) {
    const cleanFooter = stripKeepMarkers(String(opts.footer))
      .replace(/[❖✦✿♡]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanFooter) {
      const footerIcon =
        mood === 'success' ? '✨' : mood === 'warning' ? '💡' : mood === 'error' ? '🛟' : '🌸';
      out.push(DIVIDER);
      out.push(`${footerIcon} _${cleanFooter}_`);
    }
  }

  return out.join('\n');
}

/**
 * Format pesan sukses berwarna hijau cerah & rapi
 * @param {string} title
 * @param {string|string[]} details
 * @returns {string}
 */
function formatSuccess(title, details = []) {
  const arr = (Array.isArray(details) ? details : [details]).filter(Boolean);
  const lines = arr.map((line, idx) =>
    /^[✦◦❖✿•]|^[\p{Extended_Pictographic}]/u.test(String(line).trim())
      ? line
      : `${idx === 0 ? '✦' : '◦'} ${line}`
  );
  return renderBox(title, lines, {
    mood: 'success',
    footer: `${config.botName || 'CipiSMP'} • Berhasil diproses`,
  });
}

/**
 * Format pesan peringatan (Saldo Tidak Cukup, Cooldown, Kuota, Format Input) berwarna kuning/oranye jelas
 * @param {string} title
 * @param {string|string[]} details
 * @returns {string}
 */
function formatWarning(title, details = []) {
  const arr = (Array.isArray(details) ? details : [details]).filter(Boolean);
  const lines = arr.map((line, idx) =>
    /^[✦◦❖✿•]|^[\p{Extended_Pictographic}]/u.test(String(line).trim())
      ? line
      : `${idx === 0 ? '✦' : '◦'} ${line}`
  );
  return renderBox(title, lines, {
    mood: 'warning',
    footer: `${config.botName || 'CipiSMP'} • Periksa info di atas ya`,
  });
}

/**
 * Format pesan gagal/error berwarna merah jelas & sopan
 * @param {string} title
 * @param {string|string[]} details
 * @returns {string}
 */
function formatError(title, details = []) {
  const arr = (Array.isArray(details) ? details : [details]).filter(Boolean);
  const lines = arr.map((line, idx) =>
    /^[✦◦❖✿•]|^[\p{Extended_Pictographic}]/u.test(String(line).trim())
      ? line
      : `${idx === 0 ? '✦' : '◦'} ${line}`
  );
  return renderBox(title, lines, {
    mood: 'error',
    footer: `${config.botName || 'CipiSMP'} • Silakan coba kembali`,
  });
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
