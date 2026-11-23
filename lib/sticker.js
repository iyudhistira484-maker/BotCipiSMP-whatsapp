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
    // Fallback via ffmpeg bila codec WebP animasi khusus tidak terbaca sharp
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

module.exports = {
  getFfmpegPath,
  extractTargetMedia,
  downloadMediaBuffer,
  attachStickerExif,
  imageToSticker,
  videoToSticker,
  stickerToImage,
};
