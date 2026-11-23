const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const { smallcaps, keep } = require('./smallcaps');
const { logger, getWibGreeting, formatUptime, formatNumber } = require('./logger');

let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
} catch (err) {
  logger.warn('CARD', `@napi-rs/canvas tidak tersedia (${err.message}), menggunakan fallback SVG sharp`);
}

// Cache aset gambar di memori & cache kartu ber-TTL pendek
const imageAssetCache = new Map();
const cardBufferCache = new Map();

let fontFamilyMain = 'sans-serif';
let fontFamilyMono = 'monospace';
let fontsInitialized = false;

/**
 * Daftarkan font lokal dari assets/fonts/ yang mendukung penuh glyph Small Caps Unicode
 */
function ensureFontsRegistered() {
  if (fontsInitialized || !canvasLib) return;
  fontsInitialized = true;

  const { GlobalFonts } = canvasLib;
  const regularPath = path.join(config.paths.fontsDir, 'DejaVuSans.ttf');
  const boldPath = path.join(config.paths.fontsDir, 'DejaVuSans-Bold.ttf');
  const monoPath = path.join(config.paths.fontsDir, 'DejaVuSansMono.ttf');

  try {
    let registered = false;
    if (fs.existsSync(regularPath)) {
      GlobalFonts.registerFromPath(regularPath, 'CipiKawaiiSans');
      registered = true;
    }
    if (fs.existsSync(boldPath)) {
      GlobalFonts.registerFromPath(boldPath, 'CipiKawaiiSans');
      registered = true;
    }
    if (fs.existsSync(monoPath)) {
      GlobalFonts.registerFromPath(monoPath, 'CipiKawaiiMono');
      fontFamilyMono = 'CipiKawaiiMono, monospace';
    }
    if (registered) {
      fontFamilyMain = 'CipiKawaiiSans, DejaVu Sans, sans-serif';
      logger.info('CARD', 'Font small caps lokal berhasil didaftarkan dari assets/fonts/');
    }
  } catch (err) {
    logger.warn('CARD', `Gagal mendaftarkan font lokal, memakai font sistem: ${err.message}`);
  }
}

/**
 * Ganti emoji berwarna astral dengan simbol kawaii vektor yang pasti ada di DejaVuSans
 * sehingga tidak pernah muncul kotak kosong (tofu) di panel Linux tanpa font emoji
 * @param {string} text
 * @returns {string}
 */
function sanitizeCanvasGlyphs(text = '') {
  return String(text)
    .replace(/🌸|🌷|🌺|💮/g, '✿')
    .replace(/☀️|🌟|✨|⭐/g, '✦')
    .replace(/🌙|💫/g, '❖')
    .replace(/💖|💗|💓|💕|❤️/g, '♡')
    .replace(/♾️/g, '∞')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '✦');
}

/**
 * Muat gambar lokal dari assets/ atau Buffer dengan cache memori
 * @param {string|Buffer|null} source
 */
async function loadCachedImage(source) {
  if (!canvasLib || !source) return null;

  if (Buffer.isBuffer(source)) {
    return canvasLib.loadImage(source);
  }

  const resolved = path.isAbsolute(source)
    ? source
    : path.join(config.paths.assetsDir, source);

  if (imageAssetCache.has(resolved)) {
    return imageAssetCache.get(resolved);
  }

  if (!fs.existsSync(resolved)) {
    return null;
  }

  const buf = fs.readFileSync(resolved);
  const img = await canvasLib.loadImage(buf);
  imageAssetCache.set(resolved, img);
  return img;
}

/**
 * Ambil buffer avatar dari URL (misal foto profil WA) dengan timeout aman,
 * atau kembalikan null agar memakai avatar lokal dari assets/
 * @param {string|Buffer|null} avatarInput
 */
async function resolveAvatarSource(avatarInput) {
  if (!avatarInput) return null;
  if (Buffer.isBuffer(avatarInput)) return avatarInput;

  if (typeof avatarInput === 'string' && /^https?:\/\//i.test(avatarInput)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.card.avatarTimeoutMs || 4500);
    try {
      const res = await fetch(avatarInput, { signal: controller.signal });
      if (!res.ok) return null;
      const arrBuf = await res.arrayBuffer();
      return Buffer.from(arrBuf);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return avatarInput;
}

/**
 * Gambar path persegi panjang bersudut membulat (rounded rectangle)
 */
function roundedRectPath(ctx, x, y, w, h, radius = 20) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Gambar bintang kawaii 4 sudut (sparkle) secara vektor
 */
function drawSparkleStar(ctx, cx, cy, size, color = 'rgba(255, 255, 255, 0.85)') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.quadraticCurveTo(cx, cy, cx + size, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + size);
  ctx.quadraticCurveTo(cx, cy, cx - size, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// =====================================================================
// FUNGSI DASAR REUSABLE (WAJIB SESUAI SPESIFIKASI)
// =====================================================================

/**
 * 1. drawBackground — Gradasi pink pastel, ilustrasi background lokal, bokeh & sparkle kawaii
 */
async function drawBackground(ctx, width, height, opts = {}) {
  const colors = config.theme.colors;
  const bgName = opts.bgName || 'pink-sakura';

  // Isi warna dasar penuh agar sudut luar tidak menghitam saat diekspor sebagai JPEG
  ctx.fillStyle = '#FFF0F6';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  roundedRectPath(ctx, 4, 4, width - 8, height - 8, opts.outerRadius ?? 28);
  ctx.clip();

  // Gradasi dasar pink pastel lembut
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, opts.bgStart || colors.bgStart);
  grad.addColorStop(0.5, opts.bgMid || colors.bgMid);
  grad.addColorStop(1, opts.bgEnd || colors.bgEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Lapiskan gambar background lokal dari assets/backgrounds/ bila ada
  const bgCandidates = [
    path.join(config.paths.backgroundsDir, `${bgName}.jpg`),
    path.join(config.paths.backgroundsDir, `${bgName}.png`),
    path.join(config.paths.backgroundsDir, 'pink-sakura.jpg'),
  ];
  for (const candidate of bgCandidates) {
    if (fs.existsSync(candidate)) {
      const bgImg = await loadCachedImage(candidate);
      if (bgImg) {
        ctx.save();
        ctx.globalAlpha = opts.bgImageOpacity ?? 0.42;
        ctx.drawImage(bgImg, 0, 0, width, height);
        ctx.restore();
        break;
      }
    }
  }

  // Ornamen lingkaran bokeh pastel
  const bokehList = [
    { x: width * 0.12, y: height * 0.18, r: 90, a: 0.22 },
    { x: width * 0.86, y: height * 0.16, r: 120, a: 0.18 },
    { x: width * 0.76, y: height * 0.84, r: 110, a: 0.2 },
    { x: width * 0.22, y: height * 0.88, r: 75, a: 0.2 },
  ];
  for (const b of bokehList) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${b.a})`;
    ctx.fill();
  }

  // Sparkle kecil kawaii tersebar rapi
  const sparkles = [
    [54, 48, 9, '#FFFFFF'],
    [width - 60, 52, 11, '#FFF9C4'],
    [width * 0.48, 38, 7, '#FFFFFF'],
    [42, height - 46, 8, '#FFFFFF'],
    [width - 48, height - 54, 10, '#FFE082'],
    [width * 0.64, height - 34, 7, '#FFFFFF'],
  ];
  for (const [sx, sy, sr, sc] of sparkles) {
    drawSparkleStar(ctx, sx, sy, sr, sc);
  }

  // Bingkai luar tipis manis
  ctx.lineWidth = 4;
  ctx.strokeStyle = opts.outerBorderColor || colors.borderPink;
  roundedRectPath(ctx, 5, 5, width - 10, height - 10, (opts.outerRadius ?? 28) - 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * 2. drawFrame — Panel kaca pastel membulat dengan border & dekorasi sudut
 */
function drawFrame(ctx, x, y, w, h, opts = {}) {
  const colors = config.theme.colors;
  const radius = opts.radius ?? 22;

  ctx.save();

  // Bayangan lembut
  if (opts.shadow !== false) {
    ctx.shadowColor = opts.shadowColor || 'rgba(240, 98, 146, 0.18)';
    ctx.shadowBlur = opts.shadowBlur ?? 18;
    ctx.shadowOffsetY = opts.shadowOffsetY ?? 6;
  }

  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = opts.fill || colors.cardGlass;
  ctx.fill();

  // Matikan shadow untuk stroke agar garis tajam
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = opts.borderWidth ?? 2;
  ctx.strokeStyle = opts.borderColor || colors.borderPink;
  ctx.stroke();

  // Garis aksen atas opsional
  if (opts.topRibbon) {
    ctx.save();
    roundedRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    const ribGrad = ctx.createLinearGradient(x, y, x + w, y);
    ribGrad.addColorStop(0, opts.ribbonStart || colors.accentPrimary);
    ribGrad.addColorStop(1, opts.ribbonEnd || colors.accentSecondary);
    ctx.fillStyle = ribGrad;
    ctx.fillRect(x, y, w, opts.topRibbonHeight || 8);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * 3. drawAvatar — Avatar lingkaran dengan cincin gradien pink/emas & fallback aset lokal
 */
async function drawAvatar(ctx, cx, cy, size, avatarInput, opts = {}) {
  const colors = config.theme.colors;
  const radius = size / 2;

  let img = null;
  try {
    const resolved = await resolveAvatarSource(avatarInput);
    if (resolved) {
      img = await loadCachedImage(resolved);
    }
  } catch {
    img = null;
  }

  if (!img) {
    img = await loadCachedImage(opts.fallbackAsset || 'default-avatar.png');
  }

  ctx.save();

  // Lingkaran glow luar
  const ringWidth = opts.ringWidth ?? 6;
  const ringGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ringGrad.addColorStop(0, opts.ringStart || colors.accentPrimary);
  ringGrad.addColorStop(0.5, opts.ringMid || '#FFD54F');
  ringGrad.addColorStop(1, opts.ringEnd || colors.accentSecondary);

  ctx.beginPath();
  ctx.arc(cx, cy, radius + ringWidth, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.shadowColor = 'rgba(240, 98, 146, 0.32)';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Ring putih pemisah
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Clip lingkaran avatar
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (img) {
    ctx.drawImage(img, cx - radius, cy - radius, size, size);
  } else {
    ctx.fillStyle = '#FFC8DF';
    ctx.fillRect(cx - radius, cy - radius, size, size);
  }

  ctx.restore();

  // Sparkle hiasan di pojok avatar
  if (opts.sparkle !== false) {
    drawSparkleStar(ctx, cx + radius * 0.76, cy - radius * 0.76, 9, '#FFF59D');
  }
}

/**
 * 4. drawText — Auto-wrap, ukuran font menyesuaikan otomatis, & smallcaps() bawaan
 * @returns {{ endY: number, linesDrawn: number, fontSizeUsed: number }}
 */
function drawText(ctx, rawText, x, y, opts = {}) {
  const colors = config.theme.colors;
  const applySmallcaps = opts.smallcaps !== false;
  const processed = sanitizeCanvasGlyphs(
    applySmallcaps ? smallcaps(String(rawText ?? '')) : String(rawText ?? '')
  );

  const maxWidth = opts.maxWidth || 600;
  const maxLines = opts.maxLines || 3;
  let fontSize = opts.fontSize || 22;
  const minFontSize = Math.min(fontSize, opts.minFontSize || 11);
  const weight = opts.bold ? 'bold' : 'normal';
  const family = opts.mono ? fontFamilyMono : fontFamilyMain;

  let wrappedLines = [];

  const computeWrap = (size) => {
    ctx.font = `${weight} ${size}px ${family}`;
    const paragraphs = processed.split('\n');
    const lines = [];

    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push('');
        continue;
      }
      let current = words[0];
      for (let i = 1; i < words.length; i += 1) {
        const candidate = `${current} ${words[i]}`;
        if (ctx.measureText(candidate).width <= maxWidth) {
          current = candidate;
        } else {
          lines.push(current);
          current = words[i];
        }
      }
      lines.push(current);
    }
    return lines;
  };

  // Kecilkan ukuran font secara bertahap bila teks melebihi batas baris atau lebar
  while (fontSize >= minFontSize) {
    wrappedLines = computeWrap(fontSize);
    const widest = wrappedLines.reduce((m, line) => Math.max(m, ctx.measureText(line).width), 0);
    if (wrappedLines.length <= maxLines && widest <= maxWidth + 2) {
      break;
    }
    fontSize -= 1;
  }

  if (wrappedLines.length > maxLines) {
    wrappedLines = wrappedLines.slice(0, maxLines);
    let last = wrappedLines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    wrappedLines[maxLines - 1] = `${last}…`;
  }

  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.fillStyle = opts.color || colors.textPrimary;
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'top';

  const lineHeight = opts.lineHeight || Math.round(fontSize * 1.32);
  for (let i = 0; i < wrappedLines.length; i += 1) {
    ctx.fillText(wrappedLines[i], x, y + i * lineHeight);
  }
  ctx.restore();

  return {
    endY: y + wrappedLines.length * lineHeight,
    linesDrawn: wrappedLines.length,
    fontSizeUsed: fontSize,
  };
}

/**
 * 5. drawProgressBar — Progress bar membulat kawaii dengan kilau pastel & label
 */
function drawProgressBar(ctx, x, y, w, h, progress = 0, opts = {}) {
  const colors = config.theme.colors;
  const clamped = Math.min(1, Math.max(0, Number(progress || 0)));
  const radius = h / 2;

  ctx.save();

  // Track belakang
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = opts.trackColor || colors.barTrack;
  ctx.fill();

  // Isi progress
  const fillW = clamped > 0 ? Math.max(h, Math.round(w * clamped)) : 0;
  if (fillW > 0) {
    ctx.save();
    roundedRectPath(ctx, x, y, w, h, radius);
    ctx.clip();

    const barGrad = ctx.createLinearGradient(x, y, x + w, y);
    barGrad.addColorStop(0, opts.fillStart || colors.barFillStart);
    barGrad.addColorStop(1, opts.fillEnd || colors.barFillEnd);

    roundedRectPath(ctx, x, y, fillW, h, radius);
    ctx.fillStyle = barGrad;
    ctx.fill();

    // Efek kilau kaca bagian atas
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.fillRect(x, y, fillW, Math.max(3, Math.floor(h * 0.42)));
    ctx.restore();
  }

  // Border tipis
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = opts.borderColor || colors.borderPink;
  ctx.stroke();

  // Label opsional di tengah bar
  if (opts.label) {
    drawText(ctx, opts.label, x + w / 2, y + h / 2, {
      fontSize: opts.labelSize || Math.max(11, h - 7),
      bold: true,
      color: opts.labelColor || colors.textPrimary,
      align: 'center',
      baseline: 'middle',
      maxWidth: w - 12,
      maxLines: 1,
    });
  }

  ctx.restore();
}

/**
 * 6. drawBadge — Lencana pil imut (mendukung rarity N/R/SR/SSR & warna kustom)
 * @returns {{ width: number, height: number }}
 */
function drawBadge(ctx, x, y, text, opts = {}) {
  const colors = config.theme.colors;
  const rarityTheme = opts.rarity ? colors.rarity[String(opts.rarity).toUpperCase()] : null;

  const fontSize = opts.fontSize || 15;
  const padX = opts.padX ?? 14;
  const height = opts.height || fontSize + 14;
  const displayStr = sanitizeCanvasGlyphs(
    opts.smallcaps === false ? String(text || '') : smallcaps(String(text || ''))
  );

  ctx.save();
  ctx.font = `bold ${fontSize}px ${fontFamilyMain}`;
  const textW = ctx.measureText(displayStr).width;
  const width = Math.max(opts.minWidth || 0, Math.ceil(textW + padX * 2));

  roundedRectPath(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = opts.bgColor || rarityTheme?.bg || '#FFE0EC';
  ctx.fill();

  ctx.lineWidth = 1.8;
  ctx.strokeStyle = opts.borderColor || rarityTheme?.border || colors.borderDeep;
  ctx.stroke();

  ctx.fillStyle = opts.textColor || rarityTheme?.text || colors.textPrimary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayStr, x + width / 2, y + height / 2 + 0.5);
  ctx.restore();

  return { width, height };
}

// =====================================================================
// ENCODER GAMBAR, CACHE TTL & FALLBACK SHARP SVG
// =====================================================================

async function encodeCanvasOutput(canvas) {
  const pngBuffer = canvas.toBuffer('image/png');
  const format = String(config.card.format || 'jpeg').toLowerCase();
  const quality = Number(config.card.quality || 88);

  if (format === 'webp') {
    return sharp(pngBuffer).webp({ quality }).toBuffer();
  }
  return sharp(pngBuffer)
    .flatten({ background: '#FFF0F6' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Fallback kartu via sharp (SVG rasterizer) jika @napi-rs/canvas gagal dimuat di panel
 */
async function renderFallbackCardWithSharp({ title, subtitle, lines = [] }) {
  const width = 960;
  const height = 540;
  const safeTitle = escapeXml(sanitizeCanvasGlyphs(smallcaps(title || config.botName)));
  const safeSub = escapeXml(sanitizeCanvasGlyphs(smallcaps(subtitle || config.footer)));
  const lineItems = lines
    .slice(0, 8)
    .map((line, i) => {
      const y = 185 + i * 38;
      return `<text x="72" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#4A2538">${escapeXml(
        sanitizeCanvasGlyphs(smallcaps(line))
      )}</text>`;
    })
    .join('\n');

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFE4EF"/>
          <stop offset="50%" stop-color="#FFC8DF"/>
          <stop offset="100%" stop-color="#FFF3F8"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="28" fill="url(#bg)" stroke="#FF8FB8" stroke-width="4"/>
      <rect x="38" y="38" width="${width - 76}" height="${height - 76}" rx="22" fill="rgba(255,255,255,0.88)" stroke="#FF8FB8" stroke-width="2"/>
      <text x="72" y="98" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#F06292">❖ ${safeTitle} ❖</text>
      <text x="72" y="136" font-family="DejaVu Sans, sans-serif" font-size="19" fill="#7D4B63">${safeSub}</text>
      <line x1="72" y1="152" x2="${width - 72}" y2="152" stroke="#FFC8DF" stroke-width="2"/>
      ${lineItems}
    </svg>
  `;

  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Helper cache kartu ber-TTL (misal beberapa detik untuk kartu identik)
 */
async function withCardCache(cacheKey, generatorFn, ttlMs = config.card.cacheTtlMs || 8000) {
  if (cacheKey && ttlMs > 0) {
    const hit = cardBufferCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.buffer;
    }
  }

  const buffer = await generatorFn();

  if (cacheKey && ttlMs > 0 && buffer) {
    // Batasi ukuran map agar memori aman
    if (cardBufferCache.size > 80) {
      const oldestKey = cardBufferCache.keys().next().value;
      cardBufferCache.delete(oldestKey);
    }
    cardBufferCache.set(cacheKey, {
      buffer,
      expiresAt: Date.now() + ttlMs,
    });
  }
  return buffer;
}

// =====================================================================
// KARTU UTAMA FASE 1 (& REUSABLE UNTUK FASE SELANJUTNYA)
// =====================================================================

/**
 * Render Kartu Menu Utama (.menu)
 * Menampilkan ucapan WIB, nama user, level, saldo, uptime, total user, kategori command & maskot anime
 */
async function renderMenuCard({
  userName = 'Sahabat Cipi',
  level = 1,
  xp = 0,
  xpNeeded = 100,
  balance = 0,
  isPremium = false,
  isOwner = false,
  uptimeMs = 0,
  totalUsers = 1,
  categories = [],
  selectedCategory = null,
}) {
  const greetInfo = getWibGreeting();
  const uptimeBucket = Math.floor(uptimeMs / 5000); // Cache 5 detik
  const cacheKey = `menu:${userName}:${level}:${balance}:${isPremium}:${totalUsers}:${selectedCategory || 'all'}:${uptimeBucket}`;

  return withCardCache(cacheKey, async () => {
    if (!canvasLib) {
      return renderFallbackCardWithSharp({
        title: `${config.botName} - Menu Utama`,
        subtitle: `${greetInfo.greeting}, ${keep(userName)} ♡`,
        lines: [
          `✦ Level: ${level} (${xp}/${xpNeeded} XP) | Saldo: ${formatNumber(balance)} ${config.economy.currencyName}`,
          `✦ Uptime: ${formatUptime(uptimeMs)} | Total User: ${formatNumber(totalUsers)}`,
          ...categories.map((c) => `◦ ${c.title}: ${c.count} command (${config.prefix}menu ${keep(c.key)})`),
        ],
      });
    }

    ensureFontsRegistered();
    const width = 1024;
    const height = 620;
    const canvas = canvasLib.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const colors = config.theme.colors;

    await drawBackground(ctx, width, height, { bgName: 'pink-sakura' });

    // Panel Header Atas
    drawFrame(ctx, 32, 28, width - 64, 150, { topRibbon: true, radius: 24 });

    // Maskot Anime di kanan header/kartu
    await drawAvatar(ctx, width - 118, 104, 108, 'mascot.png', {
      ringStart: '#FF5C97',
      ringEnd: '#FFB74D',
    });

    // Judul & Ucapan WIB
    drawBadge(ctx, 56, 48, `✿ ${greetInfo.greeting} • WIB`, {
      bgColor: '#FFE4EF',
      borderColor: colors.accentPrimary,
      fontSize: 14,
    });

    const roleLabel = isOwner ? '✦ OWNER' : isPremium ? '✦ PREMIUM VIP' : '✦ MEMBER';
    drawBadge(ctx, 278, 48, roleLabel, {
      rarity: isOwner ? 'SSR' : isPremium ? 'SR' : 'R',
      fontSize: 14,
    });

    drawText(ctx, `❖ ${config.botName} — Menu Utama`, 56, 86, {
      fontSize: 28,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 740,
      maxLines: 1,
    });

    drawText(
      ctx,
      `Halo, ${keep(userName)} ♡ Ketik ${config.prefix}menu <kategori> untuk detail command!`,
      56,
      126,
      {
        fontSize: 17,
        color: colors.textSecondary,
        maxWidth: 740,
        maxLines: 1,
      }
    );

    // Kolom Kiri: Statistik User & Bot
    drawFrame(ctx, 32, 196, 356, 392, { radius: 22 });

    drawText(ctx, '✦ Info Petualang & Bot', 54, 216, {
      fontSize: 20,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 312,
      maxLines: 1,
    });

    const statRows = [
      ['✿ Nama', keep(userName)],
      ['✦ Level', `Lv. ${level}`],
      ['♡ Saldo', `${formatNumber(balance)} ${config.economy.currencyName}`],
      ['❖ Uptime', keep(formatUptime(uptimeMs))],
      ['◦ Total User', `${formatNumber(totalUsers)} user`],
      ['◦ Prefix', keep(config.prefix)],
    ];

    let sy = 258;
    for (const [label, val] of statRows) {
      drawText(ctx, label, 54, sy, {
        fontSize: 16,
        bold: true,
        color: colors.textSecondary,
        maxWidth: 130,
        maxLines: 1,
      });
      drawText(ctx, String(val), 186, sy, {
        fontSize: 16,
        bold: true,
        color: colors.textPrimary,
        maxWidth: 184,
        maxLines: 1,
      });
      sy += 38;
    }

    // Progress Bar XP di bagian bawah panel kiri
    drawText(ctx, `✦ Progres XP: ${formatNumber(xp)} / ${formatNumber(xpNeeded)}`, 54, 496, {
      fontSize: 14,
      bold: true,
      color: colors.textSecondary,
      maxWidth: 312,
      maxLines: 1,
    });
    const ratio = xpNeeded > 0 ? xp / xpNeeded : 0;
    drawProgressBar(ctx, 54, 522, 312, 26, ratio, {
      label: `${Math.round(ratio * 100)}%`,
    });

    // Kolom Kanan: Daftar Kategori / Command
    drawFrame(ctx, 406, 196, width - 438, 392, { radius: 22 });

    drawText(
      ctx,
      selectedCategory
        ? `❖ Kategori: ${selectedCategory.title}`
        : '❖ Daftar Kategori Command',
      430,
      216,
      {
        fontSize: 20,
        bold: true,
        color: colors.borderDeep,
        maxWidth: 530,
        maxLines: 1,
      }
    );

    if (selectedCategory && Array.isArray(selectedCategory.commands)) {
      let cy = 258;
      const shown = selectedCategory.commands.slice(0, 7);
      for (const cmd of shown) {
        drawBadge(ctx, 430, cy - 2, `${config.prefix}${cmd.name}`, {
          smallcaps: false,
          bgColor: '#FFE4EF',
          borderColor: colors.borderPink,
          fontSize: 14,
          minWidth: 112,
        });
        drawText(ctx, cmd.description || 'Command bot', 558, cy + 3, {
          fontSize: 15,
          color: colors.textPrimary,
          maxWidth: 408,
          maxLines: 1,
        });
        cy += 42;
      }
    } else {
      const displayCats = categories.slice(0, 8);
      const colW = 266;
      const boxH = 66;
      displayCats.forEach((cat, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const bx = 430 + col * (colW + 16);
        const by = 258 + row * (boxH + 12);

        drawFrame(ctx, bx, by, colW, boxH, {
          radius: 16,
          fill: colors.cardGlassSoft,
          shadow: false,
          borderWidth: 1.5,
        });

        drawText(ctx, `${cat.emoji || '✿'} ${cat.title}`, bx + 14, by + 11, {
          fontSize: 16,
          bold: true,
          color: colors.borderDeep,
          maxWidth: colW - 28,
          maxLines: 1,
        });

        drawText(ctx, `${cat.count} cmd • ${config.prefix}menu ${keep(cat.key)}`, bx + 14, by + 37, {
          fontSize: 13,
          color: colors.textSecondary,
          maxWidth: colW - 28,
          maxLines: 1,
        });
      });
    }

    drawText(ctx, config.footer, width / 2, height - 24, {
      fontSize: 13,
      bold: true,
      color: colors.textSecondary,
      align: 'center',
      baseline: 'middle',
      maxWidth: 600,
      maxLines: 1,
    });

    return encodeCanvasOutput(canvas);
  });
}

/**
 * Render Kartu Profil User (.profil)
 * Menampilkan avatar, level, bar XP, saldo, akun Minecraft (Java/Bedrock), koleksi gacha & status premium
 */
const PROFILE_FRAME_THEMES = Object.freeze({
  'pastel-ribbon': {
    border: '#FF8FB8',
    ribbonStart: '#FF5C97',
    ribbonEnd: '#FF9EC4',
    ringStart: '#FF5C97',
    ringEnd: '#FF9EC4',
  },
  'royal-gold': {
    border: '#FFA000',
    ribbonStart: '#FFB300',
    ribbonEnd: '#FFE082',
    ringStart: '#FFA000',
    ringEnd: '#FFF176',
  },
  'crystal-starlight': {
    border: '#9575CD',
    ribbonStart: '#7E57C2',
    ribbonEnd: '#80DEEA',
    ringStart: '#7E57C2',
    ringEnd: '#81D4FA',
  },
  'emerald-clover': {
    border: '#4DB6AC',
    ribbonStart: '#26A69A',
    ribbonEnd: '#A5D6A7',
    ringStart: '#26A69A',
    ringEnd: '#80CBC4',
  },
});

async function renderProfileCard({
  profile,
  avatarUrl = null,
  aiLimitText = '',
  dlLimitText = '',
}) {
  const cacheKey = `profil:${profile.jid}:${profile.level}:${profile.xp}:${profile.balance}:${
    profile.mcLink?.mc_username || 'none'
  }:${profile.gacha.uniqueCount}:${profile.profileBg}:${profile.profileFrame}:${profile.title}:${
    profile.birthday || ''
  }`;

  return withCardCache(cacheKey, async () => {
    const mcText = profile.mcLink
      ? `${keep(profile.mcLink.mc_username)} ${profile.mcLink.is_bedrock ? '(Bedrock)' : '(Java)'}`
      : 'Belum ditautkan';

    if (!canvasLib) {
      return renderFallbackCardWithSharp({
        title: `Profil ${keep(profile.name)}`,
        subtitle: `${profile.title} • Lv.${profile.level}`,
        lines: [
          `✦ Saldo: ${formatNumber(profile.balance)} ${config.economy.currencyName} | Bank: ${formatNumber(profile.bank)}`,
          `✦ XP: ${formatNumber(profile.xp)} / ${formatNumber(profile.xpNeeded)}`,
          `✦ Akun Minecraft: ${mcText}`,
          `✦ Koleksi Gacha: ${profile.gacha.uniqueCount} waifu (${profile.gacha.ssrCount} SSR)`,
          `✦ Limit AI: ${aiLimitText} | Downloader: ${dlLimitText}`,
        ],
      });
    }

    ensureFontsRegistered();
    const width = 1024;
    const height = 600;
    const canvas = canvasLib.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const colors = config.theme.colors;
    const frameTheme =
      PROFILE_FRAME_THEMES[profile.profileFrame] || PROFILE_FRAME_THEMES['pastel-ribbon'];

    await drawBackground(ctx, width, height, {
      bgName: profile.profileBg || 'pink-sakura',
      outerBorderColor: frameTheme.border,
    });

    // Bingkai Kartu Utama sesuai tema kustomisasi user
    drawFrame(ctx, 34, 32, width - 68, height - 64, {
      topRibbon: true,
      radius: 26,
      borderColor: frameTheme.border,
      borderWidth: 2.6,
      ribbonStart: frameTheme.ribbonStart,
      ribbonEnd: frameTheme.ribbonEnd,
    });

    // Avatar Besar di Kiri
    await drawAvatar(ctx, 165, 195, 168, avatarUrl, {
      ringStart: profile.premium.isOwner ? '#FFD54F' : frameTheme.ringStart,
      ringEnd: profile.premium.isPremium ? '#CE93D8' : frameTheme.ringEnd,
    });

    // Badge Role / Gelar Kustom di bawah Avatar
    const badgeLabel = profile.premium.isOwner
      ? '✦ OWNER CIPISMP'
      : profile.premium.isPremium
      ? '✦ SAKURA VIP'
      : `✿ ${profile.title || 'PETUALANG'}`;
    const badgeRarity = profile.premium.isOwner ? 'SSR' : profile.premium.isPremium ? 'SR' : 'R';
    const bDim = drawBadge(ctx, 82, 302, badgeLabel, {
      rarity: badgeRarity,
      fontSize: 13,
      minWidth: 166,
    });
    void bDim;

    // Maskot kecil pemanis di pojok kiri bawah
    await drawAvatar(ctx, 165, 456, 118, 'mascot.png', {
      ringWidth: 4,
      sparkle: false,
    });

    // Area Kanan: Identitas, Bar XP & Grid Statistik
    drawText(ctx, `❖ Kartu Profil Petualang`, 292, 62, {
      fontSize: 17,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 660,
      maxLines: 1,
    });

    drawText(ctx, keep(profile.name), 292, 92, {
      smallcaps: false,
      fontSize: 34,
      bold: true,
      color: colors.textPrimary,
      maxWidth: 660,
      maxLines: 1,
    });

    drawText(ctx, `✿ "${profile.bio}"`, 292, 138, {
      fontSize: 16,
      color: colors.textSecondary,
      maxWidth: 660,
      maxLines: 1,
    });

    // Bar XP & Level
    drawBadge(ctx, 292, 178, `✦ LEVEL ${profile.level}`, {
      bgColor: '#FFE0EC',
      borderColor: colors.accentPrimary,
      fontSize: 15,
      minWidth: 124,
    });

    drawProgressBar(ctx, 430, 181, 520, 28, profile.xpProgress, {
      label: `${formatNumber(profile.xp)} / ${formatNumber(profile.xpNeeded)} XP (${Math.round(
        profile.xpProgress * 100
      )}%)`,
    });

    // 4 Kotak Statistik Utama
    const cards = [
      {
        title: '✿ Saldo Sakura Coin',
        value: `${formatNumber(profile.balance)}`,
        sub: `Bank: ${formatNumber(profile.bank)} • Shards: ${formatNumber(profile.gachaShards)}`,
      },
      {
        title: '❖ Akun Minecraft',
        value: profile.mcLink ? keep(profile.mcLink.mc_username) : 'Belum Taut',
        sub: profile.mcLink
          ? profile.mcLink.is_bedrock
            ? 'Terverifikasi • Bedrock (Geyser)'
            : 'Terverifikasi • Java Edition'
          : `Ketik ${config.prefix}link <username>`,
      },
      {
        title: '♡ Koleksi Gacha Waifu',
        value: `${profile.gacha.uniqueCount} Karakter`,
        sub: `Total Pull: ${profile.gacha.totalPulls}x • SSR: ${profile.gacha.ssrCount}`,
      },
      {
        title: '✦ Limit Harian & Pet',
        value: profile.pet ? `Pet: ${keep(profile.pet.pet_name)} (Lv.${profile.pet.level})` : 'Belum Adopsi Pet',
        sub: `AI: ${aiLimitText || '-'} • DL: ${dlLimitText || '-'}`,
      },
    ];

    const boxW = 320;
    const boxH = 122;
    cards.forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = 292 + col * (boxW + 18);
      const by = 234 + row * (boxH + 16);

      drawFrame(ctx, bx, by, boxW, boxH, {
        radius: 18,
        fill: colors.cardGlassSoft,
        shadow: false,
      });

      drawText(ctx, item.title, bx + 16, by + 14, {
        fontSize: 15,
        bold: true,
        color: colors.borderDeep,
        maxWidth: boxW - 32,
        maxLines: 1,
      });

      drawText(ctx, item.value, bx + 16, by + 44, {
        fontSize: 22,
        bold: true,
        color: colors.textPrimary,
        maxWidth: boxW - 32,
        maxLines: 1,
      });

      drawText(ctx, item.sub, bx + 16, by + 84, {
        fontSize: 13,
        color: colors.textSecondary,
        maxWidth: boxW - 32,
        maxLines: 1,
      });
    });

    drawText(ctx, config.footer, 620, height - 54, {
      fontSize: 13,
      bold: true,
      color: colors.textMuted,
      align: 'center',
      maxWidth: 640,
      maxLines: 1,
    });

    return encodeCanvasOutput(canvas);
  }, 5000);
}

/**
 * Render Kartu Informasi / Status Serbaguna (.ping, .owner, .server, dll.)
 */
async function renderStatusCard({
  title = 'Status Bot',
  subtitle = '',
  badgeText = '✦ AKTIF',
  badgeRarity = 'SR',
  rows = [],
  avatarAsset = 'mascot.png',
  cacheKey = null,
  cacheTtlMs = 4000,
}) {
  return withCardCache(
    cacheKey,
    async () => {
      if (!canvasLib) {
        return renderFallbackCardWithSharp({
          title,
          subtitle,
          lines: rows.map(([k, v]) => `✦ ${k}: ${v}`),
        });
      }

      ensureFontsRegistered();
      const width = 960;
      const height = 520;
      const canvas = canvasLib.createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const colors = config.theme.colors;

      await drawBackground(ctx, width, height, { bgName: 'pink-sakura' });
      drawFrame(ctx, 34, 32, width - 68, height - 64, { topRibbon: true, radius: 24 });

      await drawAvatar(ctx, width - 165, height / 2, 186, avatarAsset, {
        ringStart: '#FF5C97',
        ringEnd: '#FFD54F',
      });

      drawBadge(ctx, 64, 58, badgeText, { rarity: badgeRarity, fontSize: 14 });

      drawText(ctx, `❖ ${title}`, 64, 102, {
        fontSize: 30,
        bold: true,
        color: colors.borderDeep,
        maxWidth: 610,
        maxLines: 1,
      });

      if (subtitle) {
        drawText(ctx, subtitle, 64, 144, {
          fontSize: 16,
          color: colors.textSecondary,
          maxWidth: 610,
          maxLines: 2,
        });
      }

      let ry = 196;
      for (const [label, value] of rows.slice(0, 6)) {
        drawFrame(ctx, 64, ry, 590, 42, {
          radius: 12,
          fill: colors.cardGlassSoft,
          shadow: false,
          borderWidth: 1,
        });
        drawText(ctx, `✦ ${label}`, 80, ry + 11, {
          fontSize: 15,
          bold: true,
          color: colors.textSecondary,
          maxWidth: 210,
          maxLines: 1,
        });
        drawText(ctx, String(value), 300, ry + 11, {
          fontSize: 15,
          bold: true,
          color: colors.textPrimary,
          maxWidth: 338,
          maxLines: 1,
        });
        ry += 48;
      }

      return encodeCanvasOutput(canvas);
    },
    cacheTtlMs
  );
}

/**
 * Render Kartu Welcome / Leave Grup Bergambar (Fase 2)
 */
async function renderWelcomeLeaveCard({
  mode = 'welcome', // 'welcome' | 'leave'
  userName = 'Sahabat Baru',
  userPhone = '',
  groupName = 'Grup CipiSMP',
  memberCount = 1,
  avatarUrl = null,
}) {
  const isWelcome = mode !== 'leave';
  const badgeLabel = isWelcome ? '✿ SELAMAT DATANG ♡' : '❖ SAMPAI JUMPA ✿';
  const headline = isWelcome ? 'Member Baru Bergabung!' : 'Member Meninggalkan Grup';
  const subline = isWelcome
    ? `Selamat datang di ${keep(groupName)} ♡ Semoga betah dan seru bareng ya!`
    : `Terima kasih sudah pernah meramaikan ${keep(groupName)} ✿`;

  if (!canvasLib) {
    return renderFallbackCardWithSharp({
      title: headline,
      subtitle: `${keep(userName)} (${keep(userPhone ? `+${userPhone}` : 'Member')})`,
      lines: [
        subline,
        `✦ Grup: ${keep(groupName)}`,
        `✦ Jumlah Anggota: ${formatNumber(memberCount)} member`,
      ],
    });
  }

  ensureFontsRegistered();
  const width = 980;
  const height = 500;
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const colors = config.theme.colors;

  await drawBackground(ctx, width, height, { bgName: 'pink-sakura' });
  drawFrame(ctx, 34, 30, width - 68, height - 60, {
    topRibbon: true,
    ribbonStart: isWelcome ? '#FF5C97' : '#AB47BC',
    ribbonEnd: isWelcome ? '#FFB74D' : '#FF85B3',
    radius: 26,
  });

  // Avatar member di sebelah kiri
  await drawAvatar(ctx, 185, height / 2, 188, avatarUrl, {
    ringStart: isWelcome ? '#FF5C97' : '#CE93D8',
    ringEnd: isWelcome ? '#FFD54F' : '#90CAF9',
  });

  // Maskot kecil di pojok kanan atas
  await drawAvatar(ctx, width - 110, 108, 96, 'mascot.png', {
    ringWidth: 4,
    sparkle: false,
  });

  drawBadge(ctx, 326, 66, badgeLabel, {
    rarity: isWelcome ? 'SSR' : 'SR',
    fontSize: 14,
  });

  drawText(ctx, `❖ ${headline}`, 326, 112, {
    fontSize: 28,
    bold: true,
    color: colors.borderDeep,
    maxWidth: 500,
    maxLines: 1,
  });

  drawText(ctx, keep(userName), 326, 156, {
    smallcaps: false,
    fontSize: 34,
    bold: true,
    color: colors.textPrimary,
    maxWidth: 590,
    maxLines: 1,
  });

  drawText(ctx, subline, 326, 208, {
    fontSize: 17,
    color: colors.textSecondary,
    maxWidth: 590,
    maxLines: 2,
  });

  // Kotak info grup & nomor member
  drawFrame(ctx, 326, 286, 586, 128, {
    radius: 18,
    fill: colors.cardGlassSoft,
    shadow: false,
  });

  drawText(ctx, `✿ Nama Grup   : ${keep(groupName)}`, 348, 306, {
    fontSize: 16,
    bold: true,
    color: colors.textPrimary,
    maxWidth: 540,
    maxLines: 1,
  });

  drawText(
    ctx,
    `✦ Identitas   : ${keep(userPhone ? `+${userPhone}` : userName)}`,
    348,
    340,
    {
      fontSize: 15,
      color: colors.textSecondary,
      maxWidth: 540,
      maxLines: 1,
    }
  );

  drawText(
    ctx,
    `♡ Anggota Ke  : #${formatNumber(memberCount)} Petualang`,
    348,
    372,
    {
      fontSize: 15,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 540,
      maxLines: 1,
    }
  );

  drawText(ctx, config.footer, width / 2, height - 48, {
    fontSize: 13,
    bold: true,
    color: colors.textMuted,
    align: 'center',
    maxWidth: 600,
    maxLines: 1,
  });

  return encodeCanvasOutput(canvas);
}

/**
 * Render Kartu Leaderboard Top Saldo / Top Level / Playtime (Fase 2 & Fase 5)
 */
async function renderLeaderboardCard({
  mode = 'saldo', // 'saldo' | 'level' | 'playtime'
  title = 'Papan Peringkat CipiSMP',
  subtitle = 'Petualang paling rajin & bersinar minggu ini ♡',
  entries = [],
  callerRank = null,
  callerSummary = '',
}) {
  const cacheKey = `lb:${mode}:${entries.map((e) => `${e.name}:${e.valueText}`).join('|')}:${callerRank || 0}`;

  return withCardCache(
    cacheKey,
    async () => {
      if (!canvasLib) {
        return renderFallbackCardWithSharp({
          title,
          subtitle,
          lines: entries.slice(0, 8).map((e, i) => `#${i + 1} ${keep(e.name)} — ${e.valueText}`),
        });
      }

      ensureFontsRegistered();
      const width = 1024;
      const height = 650;
      const canvas = canvasLib.createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const colors = config.theme.colors;

      await drawBackground(ctx, width, height, { bgName: 'pink-sakura' });
      drawFrame(ctx, 30, 26, width - 60, height - 52, { topRibbon: true, radius: 26 });

      // Header + Maskot
      await drawAvatar(ctx, width - 106, 94, 92, 'mascot.png', { ringWidth: 4 });

      drawBadge(ctx, 56, 48, `✿ LEADERBOARD • ${mode.toUpperCase()}`, {
        rarity: 'SSR',
        fontSize: 14,
      });

      drawText(ctx, `❖ ${title}`, 56, 86, {
        fontSize: 28,
        bold: true,
        color: colors.borderDeep,
        maxWidth: 780,
        maxLines: 1,
      });

      drawText(ctx, subtitle, 56, 124, {
        fontSize: 16,
        color: colors.textSecondary,
        maxWidth: 780,
        maxLines: 1,
      });

      // Daftar Peringkat 2 Kolom (maks 10 user: #1-#5 kiri, #6-#10 kanan)
      const shown = entries.slice(0, 10);
      const colW = 446;
      const rowH = 66;

      if (shown.length === 0) {
        drawText(ctx, 'Belum ada data petualang yang tercatat nih ♡', width / 2, 320, {
          fontSize: 20,
          color: colors.textSecondary,
          align: 'center',
          maxWidth: 700,
          maxLines: 1,
        });
      } else {
        shown.forEach((item, idx) => {
          const rank = idx + 1;
          const col = idx < 5 ? 0 : 1;
          const row = idx % 5;
          const bx = 56 + col * (colW + 20);
          const by = 166 + row * (rowH + 12);

          const isTop3 = rank <= 3;
          const rankRarity = rank === 1 ? 'SSR' : rank === 2 ? 'SR' : rank === 3 ? 'R' : 'N';

          drawFrame(ctx, bx, by, colW, rowH, {
            radius: 16,
            fill: isTop3 ? 'rgba(255, 240, 246, 0.94)' : colors.cardGlassSoft,
            borderColor: rank === 1 ? '#FFB300' : colors.borderPink,
            borderWidth: rank === 1 ? 2.4 : 1.4,
            shadow: false,
          });

          drawBadge(ctx, bx + 12, by + 17, `#${rank}`, {
            rarity: rankRarity,
            smallcaps: false,
            fontSize: 15,
            minWidth: 52,
            padX: 10,
          });

          drawText(ctx, keep(item.name || 'Sahabat Cipi'), bx + 76, by + 12, {
            smallcaps: false,
            fontSize: 17,
            bold: true,
            color: colors.textPrimary,
            maxWidth: 220,
            maxLines: 1,
          });

          if (item.subText) {
            drawText(ctx, item.subText, bx + 76, by + 38, {
              fontSize: 13,
              color: colors.textSecondary,
              maxWidth: 230,
              maxLines: 1,
            });
          }

          drawText(ctx, item.valueText || '-', bx + colW - 16, by + 22, {
            fontSize: 16,
            bold: true,
            color: colors.borderDeep,
            align: 'right',
            maxWidth: 165,
            maxLines: 1,
          });
        });
      }

      // Baris info peringkat pemanggil di bagian bawah
      if (callerSummary) {
        drawFrame(ctx, 56, 566, width - 112, 42, {
          radius: 14,
          fill: '#FFE4EF',
          shadow: false,
          borderWidth: 1.5,
        });
        drawText(ctx, `✦ Posisi Kamu: ${callerSummary}`, width / 2, 578, {
          fontSize: 15,
          bold: true,
          color: colors.textPrimary,
          align: 'center',
          maxWidth: width - 150,
          maxLines: 1,
        });
      }

      return encodeCanvasOutput(canvas);
    },
    6000
  );
}

/**
 * Render Kartu Status Server Minecraft Java + Geyser Bedrock (.server — Fase 3)
 */
async function renderServerCard({
  online = false,
  host = config.minecraft.host,
  javaPort = config.minecraft.port,
  bedrockPort = config.minecraft.bedrockPort,
  version = '-',
  motd = 'Server Komunitas CipiSMP ♡',
  playersOnline = 0,
  playersMax = 0,
  playerSample = [],
  iconBuffer = null,
  sourceApi = 'mcsrvstat',
}) {
  const cacheKey = `mcserver:${host}:${online}:${playersOnline}:${playersMax}:${playerSample.join(',')}`;

  return withCardCache(
    cacheKey,
    async () => {
      if (!canvasLib) {
        return renderFallbackCardWithSharp({
          title: `Server Minecraft ${keep(host)}`,
          subtitle: online ? `ONLINE • ${playersOnline}/${playersMax} Pemain` : 'OFFLINE / MAINTENANCE',
          lines: [
            `✦ IP Java    : ${keep(`${host}:${javaPort}`)}`,
            `✦ Port Bedrock: ${bedrockPort} (Geyser Ready)`,
            `✦ Versi      : ${keep(version || '-')}`,
            `✦ MOTD       : ${keep(motd)}`,
            playerSample.length > 0 ? `✦ Pemain     : ${keep(playerSample.slice(0, 6).join(', '))}` : '',
          ].filter(Boolean),
        });
      }

      ensureFontsRegistered();
      const width = 1024;
      const height = 600;
      const canvas = canvasLib.createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const colors = config.theme.colors;

      await drawBackground(ctx, width, height, { bgName: 'pink-sakura' });
      drawFrame(ctx, 32, 28, width - 64, height - 56, {
        topRibbon: true,
        ribbonStart: online ? '#FF5C97' : '#90A4AE',
        ribbonEnd: online ? '#FFB74D' : '#CFD8DC',
        radius: 26,
      });

      // Ikon Server MC (dari base64 mcsrvstat bila ada, fallback ke maskot)
      await drawAvatar(ctx, 148, 150, 142, iconBuffer || 'mascot.png', {
        ringStart: online ? '#66BB6A' : '#B0BEC5',
        ringEnd: online ? '#FFD54F' : '#90A4AE',
      });

      // Maskot kecil di pojok kanan atas
      await drawAvatar(ctx, width - 108, 102, 88, 'mascot.png', {
        ringWidth: 4,
        sparkle: false,
      });

      // Badge Status Online / Offline
      drawBadge(ctx, 252, 54, online ? '✦ SERVER ONLINE' : '✕ SERVER OFFLINE', {
        bgColor: online ? '#C8E6C9' : '#ECEFF1',
        borderColor: online ? '#43A047' : '#78909C',
        textColor: online ? '#1B5E20' : '#37474F',
        fontSize: 14,
      });

      drawBadge(ctx, 438, 54, '✿ JAVA & BEDROCK', {
        rarity: 'SR',
        fontSize: 14,
      });

      drawText(ctx, `❖ ${keep(host)}`, 252, 94, {
        smallcaps: false,
        fontSize: 32,
        bold: true,
        color: colors.textPrimary,
        maxWidth: 620,
        maxLines: 1,
      });

      drawText(ctx, motd || 'Selamat bermain di dunia CipiSMP ♡', 252, 138, {
        fontSize: 16,
        color: colors.textSecondary,
        maxWidth: 620,
        maxLines: 2,
      });

      // Progress Bar Kapasitas Pemain
      const ratio = online && playersMax > 0 ? Math.min(1, playersOnline / playersMax) : 0;
      drawText(
        ctx,
        `✦ Pemain Aktif: ${formatNumber(playersOnline)} / ${formatNumber(playersMax)} Online`,
        64,
        246,
        {
          fontSize: 17,
          bold: true,
          color: colors.borderDeep,
          maxWidth: 500,
          maxLines: 1,
        }
      );

      drawProgressBar(ctx, 64, 276, width - 128, 32, ratio, {
        label: online
          ? `${playersOnline} / ${playersMax} Pemain (${Math.round(ratio * 100)}%)`
          : 'Server Sedang Tidur / Maintenance',
        labelSize: 15,
      });

      // 3 Kotak Detail Teknis
      const detailBoxes = [
        {
          title: '✿ Alamat Java Edition',
          val: keep(javaPort === 25565 ? host : `${host}:${javaPort}`),
          sub: `Port Standar: ${javaPort}`,
        },
        {
          title: '❖ Bedrock / MCPE (Geyser)',
          val: keep(`${host}`),
          sub: `Port: ${bedrockPort} • Prefix "${keep(config.minecraft.bedrockPrefix)}"`,
        },
        {
          title: '✦ Versi & Engine',
          val: keep(version || 'Tidak Diketahui'),
          sub: `Sumber: ${keep(sourceApi)}`,
        },
      ];

      const boxW = 286;
      detailBoxes.forEach((b, idx) => {
        const bx = 64 + idx * (boxW + 19);
        const by = 326;
        drawFrame(ctx, bx, by, boxW, 108, {
          radius: 16,
          fill: colors.cardGlassSoft,
          shadow: false,
        });
        drawText(ctx, b.title, bx + 14, by + 12, {
          fontSize: 14,
          bold: true,
          color: colors.borderDeep,
          maxWidth: boxW - 28,
          maxLines: 1,
        });
        drawText(ctx, b.val, bx + 14, by + 40, {
          smallcaps: false,
          fontSize: 18,
          bold: true,
          color: colors.textPrimary,
          maxWidth: boxW - 28,
          maxLines: 1,
        });
        drawText(ctx, b.sub, bx + 14, by + 74, {
          fontSize: 13,
          color: colors.textSecondary,
          maxWidth: boxW - 28,
          maxLines: 1,
        });
      });

      // Baris Sampel Pemain Online (menandai pemain Bedrock berawalan ".")
      drawFrame(ctx, 64, 452, width - 128, 84, {
        radius: 16,
        fill: colors.cardGlassSoft,
        shadow: false,
      });

      drawText(ctx, '♡ Pemain yang Terlihat di Lobi:', 82, 464, {
        fontSize: 14,
        bold: true,
        color: colors.borderDeep,
        maxWidth: 400,
        maxLines: 1,
      });

      const sampleStr =
        online && playerSample.length > 0
          ? playerSample
              .slice(0, 8)
              .map((p) => {
                const isBedrock = String(p).startsWith(config.minecraft.bedrockPrefix || '.');
                return `${keep(p)}${isBedrock ? ' [BE]' : ''}`;
              })
              .join('  •  ')
          : online
          ? 'Daftar nama pemain disembunyikan atau belum ada yang online ♡'
          : 'Server belum aktif saat ini, cek lagi sebentar ya ♡';

      drawText(ctx, sampleStr, 82, 494, {
        fontSize: 15,
        color: colors.textPrimary,
        maxWidth: width - 164,
        maxLines: 1,
      });

      drawText(ctx, config.footer, width / 2, height - 42, {
        fontSize: 13,
        bold: true,
        color: colors.textMuted,
        align: 'center',
        maxWidth: 600,
        maxLines: 1,
      });

      return encodeCanvasOutput(canvas);
    },
    5000
  );
}

/**
 * Render Kartu Hasil Gacha Karakter / Waifu (N / R / SR / SSR) — Fase 6
 */
async function renderGachaCard({
  character,
  isNew = true,
  shardsGained = 0,
  totalOwnedCount = 1,
  pullSummaryList = [], // Diisi bila 10x multi-pull
  pityCounter = 0,
  userName = 'Petualang',
}) {
  const rarity = String(character.rarity || 'N').toUpperCase();
  const starsMap = { SSR: '★★★★★', SR: '★★★★', R: '★★★', N: '★★' };
  const bgByRarity = {
    SSR: 'sunset-shrine',
    SR: 'starlight-night',
    R: 'mint-meadow',
    N: 'pink-sakura',
  };

  if (!canvasLib) {
    return renderFallbackCardWithSharp({
      title: `[${rarity}] ${character.name}`,
      subtitle: `${character.title} • ${isNew ? 'KARAKTER BARU!' : `Duplikat (+${shardsGained} Shards)`}`,
      lines: [
        `✦ Elemen: ${character.element} | Bintang: ${starsMap[rarity] || '★★'}`,
        `✦ Kutipan: "${character.quote}"`,
        `✦ Pemilik: ${keep(userName)} (Total salinan: x${totalOwnedCount})`,
      ],
    });
  }

  ensureFontsRegistered();
  const width = 1024;
  const height = 600;
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const colors = config.theme.colors;
  const rTheme = colors.rarity[rarity] || colors.rarity.N;

  await drawBackground(ctx, width, height, {
    bgName: bgByRarity[rarity] || 'pink-sakura',
    outerBorderColor: rTheme.border,
  });

  drawFrame(ctx, 32, 28, width - 64, height - 56, {
    topRibbon: true,
    radius: 26,
    borderColor: rTheme.border,
    borderWidth: rarity === 'SSR' ? 3.5 : 2.5,
    ribbonStart: rTheme.border,
    ribbonEnd: colors.accentPrimary,
  });

  // Ilustrasi Karakter Lokal Berbingkai Bulat Besar di Kiri
  const imgRelPath = character.imageFile || 'mascot.png';
  await drawAvatar(ctx, 196, 232, 236, imgRelPath, {
    ringWidth: rarity === 'SSR' ? 8 : 6,
    ringStart: rTheme.border,
    ringEnd: rTheme.bg,
    sparkle: rarity === 'SSR' || rarity === 'SR',
  });

  // Lencana Status Baru / Duplikat di bawah Ilustrasi
  drawBadge(
    ctx,
    88,
    372,
    isNew ? '✦ KARAKTER BARU! ✦' : `❖ DUPLIKAT +${shardsGained} SHARDS`,
    {
      rarity: isNew ? 'SSR' : rarity,
      fontSize: 14,
      minWidth: 216,
    }
  );

  drawText(ctx, `Koleksi ke-${totalOwnedCount} milik ${keep(userName)}`, 196, 418, {
    fontSize: 13,
    bold: true,
    color: colors.textSecondary,
    align: 'center',
    maxWidth: 240,
    maxLines: 1,
  });

  // Area Kanan: Rarity, Bintang, Nama Karakter, Gelar, Quote & Ringkasan 10x
  const rBadge = drawBadge(ctx, 356, 62, `✦ RARITY ${rarity} ✦`, {
    rarity,
    fontSize: 16,
    minWidth: 158,
  });

  drawBadge(ctx, 356 + rBadge.width + 14, 62, `${starsMap[rarity] || '★★'} • ${character.element}`, {
    bgColor: '#FFF0F6',
    borderColor: colors.borderDeep,
    textColor: colors.borderDeep,
    fontSize: 15,
  });

  drawText(ctx, keep(character.name), 356, 114, {
    smallcaps: false,
    fontSize: 38,
    bold: true,
    color: colors.textPrimary,
    maxWidth: 590,
    maxLines: 1,
  });

  drawText(ctx, `✿ ${character.title}`, 356, 164, {
    fontSize: 19,
    bold: true,
    color: colors.borderDeep,
    maxWidth: 590,
    maxLines: 1,
  });

  // Kotak Kutipan Karakter
  drawFrame(ctx, 356, 206, 596, 112, {
    radius: 18,
    fill: colors.cardGlassSoft,
    borderColor: rTheme.border,
    shadow: false,
  });

  drawText(ctx, `"${character.quote}"`, 376, 224, {
    fontSize: 16,
    color: colors.textPrimary,
    maxWidth: 556,
    maxLines: 3,
  });

  // Kotak Info Pity / Ringkasan Multi-Pull 10x
  drawFrame(ctx, 356, 336, 596, 128, {
    radius: 18,
    fill: colors.cardGlassSoft,
    shadow: false,
  });

  if (Array.isArray(pullSummaryList) && pullSummaryList.length > 1) {
    drawText(ctx, '❖ Hasil Lengkap 10x Gacha Multi-Pull:', 376, 350, {
      fontSize: 14,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 556,
      maxLines: 1,
    });
    const summaryStr = pullSummaryList
      .map((p) => `[${p.rarity}] ${keep(p.shortName || p.name)}`)
      .join('  •  ');
    drawText(ctx, summaryStr, 376, 378, {
      fontSize: 14,
      color: colors.textPrimary,
      maxWidth: 556,
      maxLines: 3,
    });
  } else {
    drawText(ctx, '❖ Detail Karakter & Pity:', 376, 350, {
      fontSize: 14,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 556,
      maxLines: 1,
    });
    drawText(
      ctx,
      `✦ Pity SSR Saat Ini: ${pityCounter}/50 Pull  •  ID Koleksi: ${keep(character.id)}`,
      376,
      382,
      {
        fontSize: 15,
        color: colors.textPrimary,
        maxWidth: 556,
        maxLines: 1,
      }
    );
    drawText(
      ctx,
      '◦ Kumpulkan Starlight Shards dari duplikat untuk ditukar karakter SSR impianmu!',
      376,
      414,
      {
        fontSize: 13,
        color: colors.textSecondary,
        maxWidth: 556,
        maxLines: 1,
      }
    );
  }

  // Bar Bawah
  drawText(ctx, config.footer, width / 2, height - 46, {
    fontSize: 13,
    bold: true,
    color: colors.textMuted,
    align: 'center',
    maxWidth: 600,
    maxLines: 1,
  });

  return encodeCanvasOutput(canvas);
}

/**
 * Render Kartu Status Pet Virtual Kawaii (.pet) — Fase 6
 */
async function renderPetCard({
  pet,
  speciesMeta,
  ownerName = 'Petualang',
  xpNeeded = 100,
}) {
  if (!canvasLib) {
    return renderFallbackCardWithSharp({
      title: `Pet ${keep(pet.pet_name)} (${speciesMeta.label})`,
      subtitle: `Lv.${pet.level} • Milik ${keep(ownerName)}`,
      lines: [
        `✦ Kenyang: ${pet.hunger}% | Bahagia: ${pet.happiness}% | Energi: ${pet.energy}%`,
        `✦ XP Pet: ${pet.xp}/${xpNeeded}`,
      ],
    });
  }

  ensureFontsRegistered();
  const width = 1024;
  const height = 560;
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const colors = config.theme.colors;

  await drawBackground(ctx, width, height, { bgName: 'mint-meadow' });
  drawFrame(ctx, 32, 28, width - 64, height - 56, { topRibbon: true, radius: 26 });

  await drawAvatar(ctx, 184, 224, 210, speciesMeta.imageFile || 'mascot.png', {
    ringWidth: 6,
    ringStart: '#FF5C97',
    ringEnd: '#80CBC4',
  });

  const moodLabel =
    pet.hunger < 30
      ? '✿ Lagi Lapar...'
      : pet.energy < 25
      ? '❖ Mengantuk Zzz'
      : pet.happiness >= 80
      ? '✦ Sangat Ceria ♡'
      : '✿ Tenang & Manis';

  drawBadge(ctx, 84, 352, moodLabel, {
    rarity: pet.happiness >= 80 ? 'SSR' : 'R',
    fontSize: 14,
    minWidth: 200,
  });

  drawText(ctx, `Sahabat milik ${keep(ownerName)}`, 184, 400, {
    fontSize: 14,
    bold: true,
    color: colors.textSecondary,
    align: 'center',
    maxWidth: 230,
    maxLines: 1,
  });

  // Area Kanan: Nama Pet, Spesies & 4 Bar Status
  drawBadge(ctx, 336, 58, `✦ ${speciesMeta.label.toUpperCase()}`, {
    rarity: 'SR',
    fontSize: 14,
  });

  drawBadge(ctx, 560, 58, `★ LEVEL ${pet.level}`, {
    rarity: 'SSR',
    fontSize: 14,
  });

  drawText(ctx, keep(pet.pet_name), 336, 102, {
    smallcaps: false,
    fontSize: 36,
    bold: true,
    color: colors.textPrimary,
    maxWidth: 610,
    maxLines: 1,
  });

  drawText(ctx, `✿ "${speciesMeta.Catchphrase}"`, 336, 148, {
    fontSize: 15,
    color: colors.textSecondary,
    maxWidth: 610,
    maxLines: 1,
  });

  const bars = [
    {
      title: '✦ Kenyang (Hunger)',
      val: pet.hunger / 100,
      text: `${pet.hunger} / 100%`,
      start: '#FF8A65',
      end: '#FFAB91',
    },
    {
      title: '♡ Bahagia (Happiness)',
      val: pet.happiness / 100,
      text: `${pet.happiness} / 100%`,
      start: '#FF5C97',
      end: '#FF9EC4',
    },
    {
      title: '❖ Energi (Stamina)',
      val: pet.energy / 100,
      text: `${pet.energy} / 100%`,
      start: '#4FC3F7',
      end: '#81D4FA',
    },
    {
      title: '✿ Pertumbuhan XP',
      val: xpNeeded > 0 ? pet.xp / xpNeeded : 0,
      text: `${pet.xp} / ${xpNeeded} XP`,
      start: '#BA68C8',
      end: '#CE93D8',
    },
  ];

  bars.forEach((b, idx) => {
    const by = 192 + idx * 72;
    drawText(ctx, b.title, 336, by, {
      fontSize: 14,
      bold: true,
      color: colors.borderDeep,
      maxWidth: 320,
      maxLines: 1,
    });
    drawProgressBar(ctx, 336, by + 22, 608, 28, b.val, {
      fillStart: b.start,
      fillEnd: b.end,
      label: b.text,
      labelSize: 14,
    });
  });

  drawText(ctx, config.footer, width / 2, height - 42, {
    fontSize: 13,
    bold: true,
    color: colors.textMuted,
    align: 'center',
    maxWidth: 600,
    maxLines: 1,
  });

  return encodeCanvasOutput(canvas);
}

/**
 * Render Kartu Visual Tebak Gambar / Rebus Kawaii (.tebakgambar) — Fase 6
 */
async function renderTebakGambarCard({
  clues = [], // Array string misal: ['KUCING', '+ AIR', '- ING', '+ LAUT']
  category = 'Kata Majemuk',
  answerMask = '_ _ _ _   _ _ _ _',
  rewardCoins = 250,
}) {
  if (!canvasLib) {
    return renderFallbackCardWithSharp({
      title: 'Tebak Gambar Rebus CipiSMP',
      subtitle: `Kategori: ${category}`,
      lines: [
        `✦ Petunjuk: ${clues.join('  ')}`,
        `✦ Pola Jawaban: ${keep(answerMask)}`,
      ],
    });
  }

  ensureFontsRegistered();
  const width = 960;
  const height = 500;
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const colors = config.theme.colors;

  await drawBackground(ctx, width, height, { bgName: 'starlight-night' });
  drawFrame(ctx, 28, 24, width - 56, height - 48, { topRibbon: true, radius: 24 });

  await drawAvatar(ctx, width - 92, 86, 82, 'mascot.png', { ringWidth: 4 });

  drawBadge(ctx, 56, 48, `✿ TEBAK GAMBAR • ${category.toUpperCase()}`, {
    rarity: 'SSR',
    fontSize: 14,
  });

  drawText(ctx, '❖ Rangkai Petunjuk Visual Ini Menjadi Kata/Ungkapan!', 56, 92, {
    fontSize: 21,
    bold: true,
    color: colors.borderDeep,
    maxWidth: 760,
    maxLines: 1,
  });

  // Kotak Petunjuk Visual Berjajar
  const count = Math.max(1, clues.length);
  const gap = 18;
  const totalAreaW = width - 112;
  const boxW = Math.floor((totalAreaW - gap * (count - 1)) / count);

  clues.forEach((clueText, i) => {
    const bx = 56 + i * (boxW + gap);
    const by = 152;
    drawFrame(ctx, bx, by, boxW, 156, {
      radius: 20,
      fill: '#FFF7FA',
      borderColor: colors.accentPrimary,
      borderWidth: 2.5,
    });

    drawBadge(ctx, bx + 14, by + 14, `PETUNJUK #${i + 1}`, {
      rarity: i % 2 === 0 ? 'R' : 'SR',
      fontSize: 12,
    });

    drawText(ctx, keep(clueText), bx + boxW / 2, by + 94, {
      smallcaps: false,
      fontSize: 26,
      bold: true,
      color: colors.textPrimary,
      align: 'center',
      baseline: 'middle',
      maxWidth: boxW - 24,
      maxLines: 2,
    });
  });

  // Kotak Pola Huruf Jawaban
  drawFrame(ctx, 56, 334, width - 112, 92, {
    radius: 18,
    fill: colors.cardGlassSoft,
    shadow: false,
  });

  drawText(ctx, `Pola Huruf:   ${keep(answerMask)}`, width / 2, 352, {
    smallcaps: false,
    mono: true,
    fontSize: 22,
    bold: true,
    color: colors.borderDeep,
    align: 'center',
    maxWidth: width - 150,
    maxLines: 1,
  });

  drawText(
    ctx,
    `✦ Hadiah Benar: +${formatNumber(rewardCoins)} ${config.economy.currencyName} • Ketik jawabanmu langsung di chat!`,
    width / 2,
    392,
    {
      fontSize: 14,
      bold: true,
      color: colors.textSecondary,
      align: 'center',
      maxWidth: width - 150,
      maxLines: 1,
    }
  );

  drawText(ctx, config.footer, width / 2, height - 38, {
    fontSize: 12,
    bold: true,
    color: colors.textMuted,
    align: 'center',
    maxWidth: 600,
    maxLines: 1,
  });

  return encodeCanvasOutput(canvas);
}

module.exports = {
  // Primitif utama wajib
  drawBackground,
  drawFrame,
  drawAvatar,
  drawText,
  drawProgressBar,
  drawBadge,
  // Helper & Kartu
  ensureFontsRegistered,
  sanitizeCanvasGlyphs,
  loadCachedImage,
  renderMenuCard,
  renderProfileCard,
  renderStatusCard,
  renderWelcomeLeaveCard,
  renderLeaderboardCard,
  renderServerCard,
  renderGachaCard,
  renderPetCard,
  renderTebakGambarCard,
};
