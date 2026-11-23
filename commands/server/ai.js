const config = require('../../config');
const { askAiAssistant } = require('../../lib/api');
const {
  getDailyLimitStatus,
  consumeDailyLimit,
  formatRemainingLimit,
} = require('../../lib/limits');
const { renderBox, formatError, mono, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'ai',
  alias: ['ask', 'tanya', 'cipi'],
  category: 'server',
  description: 'Ngobrol dan bertanya apa saja ke Asisten AI kawaii CipiSMP',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, text, quotedMessage } = ctx;
    const p = config.prefix;

    const quotedText =
      quotedMessage?.conversation ||
      quotedMessage?.extendedTextMessage?.text ||
      '';

    const prompt = [text, quotedText].filter(Boolean).join('\n').trim();
    if (!prompt) {
      const rem = formatRemainingLimit(senderJid, 'ai');
      await ctx.reply(
        formatError('Mau Tanya Apa Nih?', [
          `Ketik pertanyaanmu setelah ${mono(`${p}ai`)}, contoh:`,
          `${mono(`${p}ai cara bikin farm iron di Minecraft 1.21`)}`,
          `Sisa limit AI hari ini: ${rem}`,
        ])
      );
      return;
    }

    const limitCheck = getDailyLimitStatus(senderJid, 'ai');
    if (!limitCheck.allowed) {
      await ctx.reply(
        formatError('Limit Harian AI Habis', [
          `Kuota harian ${mono(`${p}ai`)} kamu (${limitCheck.max}/${limitCheck.max}) sudah terpakai semua hari ini ♡`,
          'Limit akan direset otomatis pukul 00:00 WIB, atau upgrade ke Sakura VIP untuk kuota lebih besar!',
        ])
      );
      return;
    }

    const aiRes = await askAiAssistant(prompt, pushName);
    if (!aiRes.ok) {
      await ctx.reply(
        formatError('AI Sedang Istirahat', [
          aiRes.reason === 'missing_key'
            ? aiRes.message
            : 'Maaf kak, koneksi ke otak AI sedang sibuk sebentar nih ♡',
          aiRes.reason !== 'missing_key' ? `Detail: ${keep(aiRes.message)}` : '',
          `Sisa limit AI kamu tetap aman: ${formatRemainingLimit(senderJid, 'ai')}`,
        ].filter(Boolean))
      );
      return;
    }

    // Kurangi kuota harian hanya ketika jawaban berhasil diterima
    consumeDailyLimit(senderJid, 'ai', 1);
    const remainingLabel = formatRemainingLimit(senderJid, 'ai');

    const replyBox = renderBox(
      `✿ ᴀsɪsᴛᴇɴ ᴀɪ ${config.botShortName}`,
      [
        `✦ ${keep(aiRes.answer)}`,
        '',
        `◦ Provider   : ${keep(aiRes.provider)}`,
        `◦ Sisa Limit : ${remainingLabel}`,
      ],
      { footer: config.footer }
    );

    await ctx.reply(replyBox);
  },
};
