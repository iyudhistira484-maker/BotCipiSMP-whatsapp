const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const webp = require('node-webpmux');
const config = require('../config');
const { unwrapMessageContent } = require('./buttons');
const { baileysLogger, logger } = require('./logger');

const execFileAsync = promisify(execFile);

let resolvedFfmpegBin = null;

/**
 * Cari path binary ffmpeg (@ffmpeg-installer/ffmpeg dari npm atau sistem OS)
 */
function getFfmpegPath() {
  if (resolvedFfmpegBin) return resolvedFfmpegBin;
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer?.path && fs.existsSync(installer.path)) {
      resolvedFfmpegBin = installer.path;
      return resolvedFfmpegBin;
    }
  } catch {
    // Lanjut cek ffmpeg sistem
  }
  resolvedFfmpegBin = 'ffmpeg';
  return resolvedFfmpegBin;
}

/**
 * Buat buffer EXIF standar WhatsApp Sticker Pack
 */
function buildWhatsAppStickerExif(packName, packPublisher, emojis = ['🌸', '✨']) {
  const jsonPayload = {
    'sticker-pack-id': `com.cipismp.kawaii.${crypto.randomBytes(6).toString('hex')}`,
    'sticker-pack-name': String(packName || config.sticker.packName || config.botName),
    'sticker-pack-publisher': String(packPublisher || config.sticker.author || config.ownerName),
    emojis,
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuf = Buffer.from(JSON.stringify(jsonPayload), 'utf8');
  const exif = Buffer.concat([exifAttr, jsonBuf]);
  exif.writeUInt32LE(jsonBuf.length, 14);
  return exif;
}

/**
 * Suntikkan metadata EXIF ke file WebP menggunakan node-webpmux
 */
async function attachStickerExif(webpBuffer, { packName, author } = {}) {
  try {
    const img = new webp.Image();
    await img.load(webpBuffer);
    img.exif = buildWhatsAppStickerExif(packName, author);
    return await img.save(null);
  } catch (err) {
    logger.warn('STICKER', `Gagal menyematkan EXIF stiker, mengirim WebP murni: ${err.message}`);
    return webpBuffer;
  }
}

/**
 * Ekstrak pesan media (gambar / video / stiker) dari pesan langsung atau pesan yang di-reply
 */
function extractTargetMedia(msg, quotedMessage = null, contextInfo = null) {
  const direct = unwrapMessageContent(msg?.message);

  const pickMedia = (content, isQuoted, stanzaKey) => {
    if (!content) return null;
    if (content.imageMessage) {
      return {
        kind: 'image',
        mime: content.imageMessage.mimetype || 'image/jpeg',
        bytes: Number(content.imageMessage.fileLength || 0),
        seconds: 0,
        isQuoted,
        downloadTarget: { key: stanzaKey, message: { imageMessage: content.imageMessage } },
      };
    }
    if (content.videoMessage) {
      return {
        kind: 'video',
        mime: content.videoMessage.mimetype || 'video/mp4',
        bytes: Number(content.videoMessage.fileLength || 0),
        seconds: Number(content.videoMessage.seconds || 0),
        isGif: Boolean(content.videoMessage.gifPlayback),
        isQuoted,
        downloadTarget: { key: stanzaKey, message: { videoMessage: content.videoMessage } },
      };
    }
    if (content.stickerMessage) {
      return {
        kind: 'sticker',
        mime: content.stickerMessage.mimetype || 'image/webp',
        bytes: Number(content.stickerMessage.fileLength || 0),
        isAnimated: Boolean(content.stickerMessage.isAnimated),
        isQuoted,
        downloadTarget: { key: stanzaKey, message: { stickerMessage: content.stickerMessage } },
      };
    }
    if (
      content.documentMessage &&
      /^(image|video)\//i.test(content.documentMessage.mimetype || '')
    ) {
      const isVid = /^video\//i.test(content.documentMessage.mimetype || '');
      return {
        kind: isVid ? 'video' : 'image',
        mime: content.documentMessage.mimetype,
        bytes: Number(content.documentMessage.fileLength || 0),
        seconds: 0,
        isQuoted,
        downloadTarget: { key: stanzaKey, message: { documentMessage: content.documentMessage } },
      };
    }
    return null;
  };

  const directMedia = pickMedia(direct, false, msg?.key);
  if (directMedia) return directMedia;

  if (quotedMessage) {
    const quotedKey = {
      remoteJid: msg?.key?.remoteJid,
      id: contextInfo?.stanzaId || 'QUOTED_MSG',
      participant: contextInfo?.participant || undefined,
    };
    return pickMedia(quotedMessage, true, quotedKey);
  }

  return null;
}

/**
 * Unduh buffer media menggunakan utilitas resmi @whiskeysockets/baileys
 */
async function downloadMediaBuffer(sock, mediaDescriptor) {
  const maxBytes = Number(config.sticker?.maxMediaBytes || 12 * 1024 * 1024);
  if (mediaDescriptor.bytes && mediaDescriptor.bytes > maxBytes) {
    throw new Error(`Ukuran file terlalu besar (maksimal ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`);
  }

  const baileys = await import('@whiskeysockets/baileys');
  const buf = await baileys.downloadMediaMessage(
    mediaDescriptor.downloadTarget,
    'buffer',
    {},
    {
      logger: baileysLogger,
      reuploadRequest: sock?.updateMediaMessage,
    }
  );

  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('Media kosong atau gagal diunduh dari WhatsApp');
  }
  if (buf.length > maxBytes) {
    throw new Error(`Ukuran file melebihi batas ${(maxBytes / 1024 / 1024).toFixed(0)} MB`);
  }
  return buf;
}

/**
 * Konversi Buffer Gambar (JPG/PNG/WebP/GIF) menjadi Stiker WebP 512x512
 */
async function imageToSticker(inputBuffer, opts = {}) {
  const fitMode = opts.crop ? 'cover' : 'contain';
  const rawWebp = await sharp(inputBuffer, { animated: true })
    .resize(512, 512, {
      fit: fitMode,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();

  return attachStickerExif(rawWebp, opts);
}

/**
 * Konversi Buffer Video / MP4 / GIF menjadi Stiker Animasi WebP <= 512x512 via ffmpeg
 */
async function videoToSticker(inputBuffer, opts = {}) {
  const tmpId = crypto.randomBytes(8).toString('hex');
  const inFile = path.join(os.tmpdir(), `cipi-in-${tmpId}.mp4`);
  const outFile = path.join(os.tmpdir(), `cipi-out-${tmpId}.webp`);
  const maxSec = Number(config.sticker?.maxVideoSeconds || 7);
  const ffmpegBin = getFfmpegPath();

  fs.writeFileSync(inFile, inputBuffer);

  const scaleFilter = opts.crop
    ? 'fps=14,scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
    : 'fps=14,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

  try {
    const runEncode = async (quality, fpsFilter) => {
      await execFileAsync(
        ffmpegBin,
        [
          '-y',
          '-t',
          String(maxSec),
          '-i',
          inFile,
          '-vcodec',
          'libwebp',
          '-vf',
          fpsFilter,
          '-lossless',
          '0',
          '-compression_level',
          '4',
          '-q:v',
          String(quality),
          '-loop',
          '0',
          '-preset',
          'default',
          '-an',
          '-vsync',
          '0',
          outFile,
        ],
        { timeout: 35000 }
      );
      return fs.readFileSync(outFile);
    };

    let webpBuf = await runEncode(52, scaleFilter);

    // Jika ukuran melebihi ~920 KB, kompres ulang agar animasi tetap jalan di WhatsApp HP
    if (webpBuf.length > 920 * 1024) {
      const lighterFilter = scaleFilter.replace('fps=14', 'fps=10');
      webpBuf = await runEncode(34, lighterFilter);
    }

    return await attachStickerExif(webpBuf, opts);
  } finally {
    try {
      if (fs.existsSync(inFile)) fs.unlinkSync(inFile);
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    } catch {
      // Abaikan kegagalan bersih-bersih tmp
    }
  }
}

/**
 * Konversi Stiker WebP menjadi Gambar PNG jernih (.toimg)
 */
async function stickerToImage(webpBuffer) {
  try {
    return await sharp(webpBuffer, { pages: 1 }).png({ compressionLevel: 8 }).toBuffer();
  } catch {
    // Fallback via ffmpeg bila codec WebP animasi khusus khusus tidak terbaca sharp
    const tmpId = crypto.randomBytes(8).toString('hex');
    const inFile = path.join(os.tmpdir(), `cipi-stk-${tmpId}.webp`);
    const outFile = path.join(os.tmpdir(), `cipi-img-${tmpId}.png`);
    fs.writeFileSync(inFile, webpBuffer);
    try {
      await execFileAsync(
        getFfmpegPath(),
        ['-y', '-i', inFile, '-vframes', '1', outFile],
        { timeout: 20000 }
      );
      return fs.readFileSync(outFile);
    } finally {
      try {
        if (fs.existsSync(inFile)) fs.unlinkSync(inFile);
        if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
      } catch {
        // Abaikan
      }
    }
  }
}

// =====================================================================
// GENERATOR STIKER LOKAL: .qc (QUOTE CHAT WA) & .brat (TEKS BRAT)
// =====================================================================

let canvasEngine = null;
let stickerFontsReady = false;
let stickerFontFamily = 'DejaVu Sans, sans-serif';

function ensureStickerCanvasReady() {
  if (!canvasEngine) {
    canvasEngine = require('@napi-rs/canvas');
  }
  if (!stickerFontsReady && canvasEngine?.GlobalFonts) {
    stickerFontsReady = true;
    try {
      const reg = path.join(config.paths.fontsDir, 'DejaVuSans.ttf');
      const bold = path.join(config.paths.fontsDir, 'DejaVuSans-Bold.ttf');
      if (fs.existsSync(reg)) canvasEngine.GlobalFonts.registerFromPath(reg, 'CipiStickerSans');
      if (fs.existsSync(bold)) canvasEngine.GlobalFonts.registerFromPath(bold, 'CipiStickerSans');
      stickerFontFamily = 'CipiStickerSans, DejaVu Sans, sans-serif';
    } catch {
      // Gunakan fallback font sistem
    }
  }
  return canvasEngine;
}

function cleanStickerTextGlyphs(raw = '') {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/🌸|🌷|🌺|💮/g, '✿')
    .replace(/✨|🌟|⭐/g, '✦')
    .replace(/💖|💗|💓|💕|❤️|🩷/g, '♡')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .trim();
}

function wrapCanvasParagraphs(ctx2d, rawText, maxWidth, maxLines = 8) {
  const paragraphs = String(rawText || '').split('\n');
  const lines = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      if (lines.length > 0 && lines.length < maxLines) lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';

    for (const word of words) {
      // Potong kata super panjang tanpa spasi agar tidak tembus kotak
      if (ctx2d.measureText(word).width > maxWidth) {
        if (current) {
          lines.push(current);
          current = '';
          if (lines.length >= maxLines) break;
        }
        let chunk = '';
        for (const ch of word) {
          if (ctx2d.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
            if (lines.length >= maxLines) break;
          } else {
            chunk += ch;
          }
        }
        if (lines.length >= maxLines) break;
        current = chunk;
        continue;
      }

      const candidate = current ? `${current} ${word}` : word;
      if (ctx2d.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
        if (lines.length >= maxLines) break;
      }
    }

    if (lines.length >= maxLines) break;
    if (current) lines.push(current);
    if (lines.length >= maxLines) break;
  }

  return lines.slice(0, maxLines);
}

function pickNameAccentColor(seed = '', isLightTheme = false) {
  const darkPalette = ['#34D399', '#60A5FA', '#F472B6', '#FBBF24', '#A78BFA', '#38BDF8', '#FB7185'];
  const lightPalette = ['#059669', '#2563EB', '#DB2777', '#D97706', '#7C3AED', '#0284C7', '#E11D48'];
  let hash = 0;
  const s = String(seed || 'Cipi');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  const list = isLightTheme ? lightPalette : darkPalette;
  return list[hash % list.length];
}

function drawRoundedBubbleWithTail(ctx2d, x, y, w, h, r, tailWidth = 14) {
  ctx2d.beginPath();
  ctx2d.moveTo(x - tailWidth, y);
  ctx2d.lineTo(x + w - r, y);
  ctx2d.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx2d.lineTo(x + w, y + h - r);
  ctx2d.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx2d.lineTo(x + r, y + h);
  ctx2d.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx2d.lineTo(x, y + 20);
  ctx2d.quadraticCurveTo(x - 2, y + 8, x - tailWidth, y);
  ctx2d.closePath();
}

/**
 * Render Stiker Bubble Chat WhatsApp (.qc) transparan 512x512 dengan resolusi tinggi
 */
async function renderQuoteChatSticker({
  senderName = 'Member',
  text = '',
  avatarBuffer = null,
  theme = 'dark',
  timeText = '',
  packName,
  author,
} = {}) {
  const { createCanvas, loadImage } = ensureStickerCanvasReady();

  const cleanName = (cleanStickerTextGlyphs(senderName) || 'Member').slice(0, 28);
  const cleanBody = (cleanStickerTextGlyphs(text) || '...').slice(0, 280);

  const themeKey = String(theme || 'dark').toLowerCase();
  const isLight = themeKey === 'putih' || themeKey === 'light' || themeKey === 'terang';
  const isPink = themeKey === 'pink' || themeKey === 'sakura';

  const palette = isLight
    ? {
        bubbleBg: '#FFFFFF',
        bubbleBorder: 'rgba(15, 23, 42, 0.10)',
        textColor: '#111B21',
        timeColor: '#667781',
      }
    : isPink
    ? {
        bubbleBg: '#2B1825',
        bubbleBorder: 'rgba(244, 114, 182, 0.28)',
        textColor: '#FCE7F3',
        timeColor: '#F9A8D4',
      }
    : {
        bubbleBg: '#1F2C34',
        bubbleBorder: 'rgba(255, 255, 255, 0.08)',
        textColor: '#E9EDEF',
        timeColor: '#8696A0',
      };

  const nameColor = pickNameAccentColor(cleanName, isLight);

  const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
  const stamp =
    timeText ||
    `${String(nowWib.getUTCHours()).padStart(2, '0')}.${String(nowWib.getUTCMinutes()).padStart(2, '0')}`;

  // Kanvas supersampling 768px lalu diperkecil tajam ke 512x512 WebP transparan
  const W = 768;
  const probe = createCanvas(W, 200);
  const pCtx = probe.getContext('2d');

  const bodyFontSize = cleanBody.length <= 42 ? 33 : cleanBody.length <= 110 ? 29 : 25;
  const lineHeight = Math.round(bodyFontSize * 1.36);
  const nameFontSize = 27;

  const avatarSize = 96;
  const avatarX = 24;
  const bubbleX = avatarX + avatarSize + 24;
  const maxBubbleInnerW = W - bubbleX - 68;

  pCtx.font = `bold ${nameFontSize}px ${stickerFontFamily}`;
  const nameWidth = Math.min(maxBubbleInnerW, pCtx.measureText(cleanName).width);

  pCtx.font = `400 ${bodyFontSize}px ${stickerFontFamily}`;
  const wrappedLines = wrapCanvasParagraphs(pCtx, cleanBody, maxBubbleInnerW, 9);

  let maxLineW = 0;
  for (const ln of wrappedLines) {
    const w = pCtx.measureText(ln).width;
    if (w > maxLineW) maxLineW = w;
  }

  pCtx.font = `400 20px ${stickerFontFamily}`;
  const timeWidth = pCtx.measureText(stamp).width + 18;

  const padX = 28;
  const padTop = 22;
  const padBottom = 22;
  const nameBottomGap = 12;

  // Cek apakah jam muat sebaris dengan baris terakhir
  const lastLine = wrappedLines[wrappedLines.length - 1] || '';
  pCtx.font = `400 ${bodyFontSize}px ${stickerFontFamily}`;
  const lastLineW = pCtx.measureText(lastLine).width;
  const inlineTimeFits = lastLineW + timeWidth + 14 <= maxBubbleInnerW;

  const contentW = Math.max(
    180,
    nameWidth,
    inlineTimeFits ? Math.max(maxLineW, lastLineW + timeWidth + 14) : Math.max(maxLineW, timeWidth)
  );
  const bubbleW = Math.min(W - bubbleX - 24, Math.ceil(contentW + padX * 2));
  const extraTimeRow = inlineTimeFits ? 6 : 28;
  const bubbleH = Math.max(
    112,
    padTop + nameFontSize + nameBottomGap + wrappedLines.length * lineHeight + extraTimeRow + padBottom
  );

  const H = Math.max(W, bubbleH + 80);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const topY = Math.round((H - bubbleH) / 2);

  // 1. Gambar Avatar Melingkar
  const avatarCenterX = avatarX + avatarSize / 2;
  const avatarCenterY = topY + avatarSize / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.30)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = nameColor;
  ctx.fill();
  ctx.restore();

  let drewPhoto = false;
  if (Buffer.isBuffer(avatarBuffer) && avatarBuffer.length > 0) {
    try {
      const normalizedAvatar = await sharp(avatarBuffer)
        .resize(avatarSize * 2, avatarSize * 2, { fit: 'cover' })
        .png()
        .toBuffer();
      const img = await loadImage(normalizedAvatar);
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, avatarX, topY, avatarSize, avatarSize);
      ctx.restore();
      drewPhoto = true;
    } catch {
      drewPhoto = false;
    }
  }

  if (!drewPhoto) {
    const initials = cleanName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || 'C';
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 38px ${stickerFontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, avatarCenterX, avatarCenterY + 2);
    ctx.restore();
  }

  // Ring tipis di tepi avatar
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 2. Gambar Gelembung Chat WhatsApp + Ekor
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  drawRoundedBubbleWithTail(ctx, bubbleX, topY, bubbleW, bubbleH, 24, 15);
  ctx.fillStyle = palette.bubbleBg;
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedBubbleWithTail(ctx, bubbleX, topY, bubbleW, bubbleH, 24, 15);
  ctx.strokeStyle = palette.bubbleBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 3. Tulis Nama Pengirim
  ctx.fillStyle = nameColor;
  ctx.font = `bold ${nameFontSize}px ${stickerFontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(cleanName, bubbleX + padX, topY + padTop);

  // 4. Tulis Isi Pesan
  ctx.fillStyle = palette.textColor;
  ctx.font = `400 ${bodyFontSize}px ${stickerFontFamily}`;
  let cursorY = topY + padTop + nameFontSize + nameBottomGap;
  for (const line of wrappedLines) {
    ctx.fillText(line, bubbleX + padX, cursorY);
    cursorY += lineHeight;
  }

  // 5. Tulis Timestamp WIB di kanan bawah bubble
  ctx.fillStyle = palette.timeColor;
  ctx.font = `400 20px ${stickerFontFamily}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(stamp, bubbleX + bubbleW - 22, topY + bubbleH - 15);

  const rawPng = canvas.toBuffer('image/png');
  const webpBuf = await sharp(rawPng)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 90, alphaQuality: 95, effort: 4 })
    .toBuffer();

  return attachStickerExif(webpBuf, { packName, author });
}

/**
 * Render Stiker Teks .brat (512x512 auto-fit font dengan varian putih, hijau brat, hitam, pink)
 */
async function renderBratSticker({
  text = '',
  theme = 'white',
  packName,
  author,
} = {}) {
  const { createCanvas } = ensureStickerCanvasReady();
  const cleanText = (cleanStickerTextGlyphs(text) || 'brat')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 180);

  const mode = String(theme || 'white').toLowerCase();
  const scheme =
    mode === 'hijau' || mode === 'lime' || mode === 'green'
      ? { bg: '#8ACE00', fg: '#0A0A0A' }
      : mode === 'hitam' || mode === 'dark' || mode === 'black'
      ? { bg: '#111111', fg: '#F5F5F5' }
      : mode === 'pink' || mode === 'sakura'
      ? { bg: '#FFB7D5', fg: '#1A0D14' }
      : { bg: '#FFFFFF', fg: '#0A0A0A' };

  const SIZE = 512;
  const PAD = 38;
  const maxBoxW = SIZE - PAD * 2;
  const maxBoxH = SIZE - PAD * 2;

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = scheme.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Cari ukuran font terbesar yang muat rapi di dalam kanvas 512x512
  let chosenFont = 32;
  let chosenLines = [cleanText];

  for (let fontSize = 112; fontSize >= 26; fontSize -= 4) {
    ctx.font = `400 ${fontSize}px ${stickerFontFamily}`;
    const lines = wrapCanvasParagraphs(ctx, cleanText, maxBoxW, 14);
    const lineH = Math.round(fontSize * 1.16);
    const totalH = lines.length * lineH;

    let widest = 0;
    for (const ln of lines) {
      const w = ctx.measureText(ln).width;
      if (w > widest) widest = w;
    }

    const charCountFitted = lines.join(' ').length;
    if (widest <= maxBoxW + 2 && totalH <= maxBoxH && charCountFitted >= cleanText.length - 2) {
      chosenFont = fontSize;
      chosenLines = lines;
      break;
    }
    chosenFont = fontSize;
    chosenLines = lines;
  }

  ctx.fillStyle = scheme.fg;
  ctx.font = `400 ${chosenFont}px ${stickerFontFamily}`;
  ctx.textBaseline = 'top';

  const lineH = Math.round(chosenFont * 1.16);
  const blockH = chosenLines.length * lineH;
  // Jika cuma 1 kata pendek, taruh tepat di tengah seperti cover asli; jika kalimat multi-baris, rata kiri khas meme brat WA
  const isSingleShortLine = chosenLines.length === 1 && cleanText.length <= 10;
  let startY = Math.max(PAD, Math.round((SIZE - blockH) / 2));

  for (const ln of chosenLines) {
    if (isSingleShortLine) {
      ctx.textAlign = 'center';
      ctx.fillText(ln, SIZE / 2, startY);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(ln, PAD, startY);
    }
    startY += lineH;
  }

  const rawPng = canvas.toBuffer('image/png');
  // Sentuhan blur halus 0.65px agar persis estetika lo-fi Brat asli
  const webpBuf = await sharp(rawPng)
    .blur(0.65)
    .resize(512, 512, { fit: 'fill' })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();

  return attachStickerExif(webpBuf, { packName, author });
}

module.exports = {
  getFfmpegPath,
  extractTargetMedia,
  downloadMediaBuffer,
  attachStickerExif,
  imageToSticker,
  videoToSticker,
  stickerToImage,
  renderQuoteChatSticker,
  renderBratSticker,
};
