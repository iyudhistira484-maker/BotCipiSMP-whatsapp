const config = require('../../config');
const { downloadRemoteBuffer } = require('../../lib/api');
const {
  getDailyLimitStatus,
  consumeDailyLimit,
  formatRemainingLimit,
} = require('../../lib/limits');
const { renderBox, formatError, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

/**
 * Ekstrak URL pertama dari teks argumen atau pesan yang di-reply
 */
function extractFirstUrl(ctx) {
  const quotedText =
    ctx.quotedMessage?.conversation ||
    ctx.quotedMessage?.extendedTextMessage?.text ||
    '';
  const combined = `${ctx.text || ''} ${quotedText}`;
  const match = /https?:\/\/[^\s<>"]+/i.exec(combined);
  return match ? match[0] : '';
}

/**
 * Jalankan alur unduh berbatas limit harian WIB + kirim media ke WhatsApp
 */
async function executeMediaDownload(ctx, {
  platformLabel,
  exampleCmd,
  fetcherFn,
}) {
  const { sock, msg, chatJid, senderJid } = ctx;
  const p = config.prefix;

  const targetUrl = extractFirstUrl(ctx);
  if (!targetUrl) {
    await ctx.reply(
      formatError(`Link ${platformLabel} Belum Ada`, [
        `Tempel link setelah command, contoh: ${mono(`${p}${exampleCmd}`)}`,
        `Sisa limit downloader: ${formatRemainingLimit(senderJid, 'downloader')}`,
      ])
    );
    return;
  }

  const limitStatus = getDailyLimitStatus(senderJid, 'downloader');
  if (!limitStatus.allowed) {
    await ctx.reply(
      formatError('Limit Downloader Habis', [
        `Kuota harian downloader kamu (${limitStatus.max}/${limitStatus.max}) sudah habis hari ini ♡`,
        'Tunggu reset otomatis pukul 00:00 WIB atau upgrade ke Sakura VIP ya!',
      ])
    );
    return;
  }

  const apiResult = await fetcherFn(targetUrl);
  if (!apiResult.ok) {
    await ctx.reply(
      formatError(`Unduhan ${platformLabel} Gagal`, [
        apiResult.reason || 'Media tidak dapat diambil saat ini ♡',
        `Sisa limit tetap aman: ${formatRemainingLimit(senderJid, 'downloader')}`,
      ])
    );
    return;
  }

  try {
    // Jika hasil berupa slide foto (misal TikTok Photo Mode)
    if (apiResult.type === 'images' && Array.isArray(apiResult.images)) {
      const firstSlide = await downloadRemoteBuffer(apiResult.images[0]);
      consumeDailyLimit(senderJid, 'downloader', 1);
      const remLabel = formatRemainingLimit(senderJid, 'downloader');

      const caption = renderBox(
        `✿ ${platformLabel} sʟɪᴅᴇ`,
        [
          `✦ Judul      : ${keep((apiResult.title || '-').slice(0, 120))}`,
          apiResult.author ? `✦ Kreator    : ${keep(apiResult.author)}` : '',
          `◦ Sumber API : ${keep(apiResult.provider)}`,
          `◦ Sisa Limit : ${remLabel}`,
        ].filter(Boolean),
        { footer: config.footer }
      );

      await sock.sendMessage(
        chatJid,
        { image: firstSlide.buffer, caption },
        { quoted: msg }
      );

      for (let i = 1; i < Math.min(apiResult.images.length, 5); i += 1) {
        try {
          const nextSlide = await downloadRemoteBuffer(apiResult.images[i]);
          await sock.sendMessage(chatJid, { image: nextSlide.buffer });
        } catch {
          // Lewati slide gagal tanpa menghentikan sisanya
        }
      }
      return;
    }

    const mediaDownloaded = await downloadRemoteBuffer(apiResult.mediaUrl);
    consumeDailyLimit(senderJid, 'downloader', 1);
    const remLabel = formatRemainingLimit(senderJid, 'downloader');

    const caption = renderBox(
      `✿ ᴜɴᴅᴜʜᴀɴ ${platformLabel}`,
      [
        `✦ Judul      : ${keep((apiResult.title || platformLabel).slice(0, 120))}`,
        apiResult.author ? `✦ Kreator    : ${keep(apiResult.author)}` : '',
        `◦ Sumber API : ${keep(apiResult.provider)}`,
        `◦ Sisa Limit : ${remLabel}`,
      ].filter(Boolean),
      { footer: config.footer }
    );

    if (apiResult.type === 'audio') {
      await sock.sendMessage(
        chatJid,
        {
          audio: mediaDownloaded.buffer,
          mimetype: 'audio/mpeg',
          ptt: false,
        },
        { quoted: msg }
      );
      await ctx.reply(caption);
      return;
    }

    if (apiResult.type === 'image') {
      await sock.sendMessage(
        chatJid,
        {
          image: mediaDownloaded.buffer,
          caption,
        },
        { quoted: msg }
      );
      return;
    }

    await sock.sendMessage(
      chatJid,
      {
        video: mediaDownloaded.buffer,
        mimetype: 'video/mp4',
        caption,
      },
      { quoted: msg }
    );
  } catch (err) {
    logger.error(`DL:${platformLabel.toUpperCase()}`, 'Gagal mengunduh/mengirim file media', err);
    await ctx.reply(
      formatError(`Gagal Mengirim ${platformLabel}`, [
        `Maaf kak, file gagal diunduh: ${keep(err.message)}`,
        `Sisa limit tetap aman: ${formatRemainingLimit(senderJid, 'downloader')}`,
      ])
    );
  }
}

module.exports = {
  extractFirstUrl,
  executeMediaDownload,
};
