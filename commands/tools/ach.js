const config = require('../../config');
const { renderMinecraftAchievementCard } = require('../../lib/card');
const { renderAchievementSticker } = require('../../lib/sticker');
const { formatError, boldSans, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

const ICON_KEYWORDS = new Set([
  'diamond', 'berlian',
  'creeper', 'bom', 'ledak',
  'sword', 'pedang', 'pvp',
  'apple', 'apel', 'gapple',
  'grass', 'rumput', 'blok',
  'crown', 'mahkota', 'raja',
]);

function extractQuotedText(quotedMessage) {
  if (!quotedMessage) return '';
  return String(
    quotedMessage.conversation ||
      quotedMessage.extendedTextMessage?.text ||
      quotedMessage.imageMessage?.caption ||
      quotedMessage.videoMessage?.caption ||
      ''
  ).trim();
}

module.exports = {
  name: 'ach',
  alias: ['achievement', 'advancement', 'mcach', 'sach'],
  category: 'tools',
  description: 'Buat gambar atau stiker Achievement Get! khas Minecraft secara instan',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      msg,
      chatJid,
      pushName,
      commandName,
      args,
      text,
      quotedMessage,
    } = ctx;
    const p = config.prefix || '.';

    let sendAsSticker = String(commandName || '').toLowerCase() === 'sach';
    let icon = 'auto';
    let workingText = String(text || '').trim();

    // Cek flag awal "stiker" / "sticker" / "-s"
    const tokens = workingText.split(/\s+/).filter(Boolean);
    if (tokens.length > 0 && /^(?:stiker|sticker|-s)$/i.test(tokens[0])) {
      sendAsSticker = true;
      workingText = workingText.slice(tokens[0].length).trim();
      tokens.shift();
    }

    // Cek pilihan ikon opsional di argumen pertama
    if (tokens.length > 0 && ICON_KEYWORDS.has(tokens[0].toLowerCase())) {
      const rest = workingText.slice(tokens[0].length).trim();
      if (rest || quotedMessage) {
        icon = tokens[0].toLowerCase();
        workingText = rest;
      }
    }

    const fallbackQuoted = extractQuotedText(quotedMessage);
    const rawContent = workingText || fallbackQuoted;

    if (!rawContent) {
      await ctx.reply(
        formatError('Teks Achievement Kosong', [
          `Gambar : ${mono(`${p}ach Dapat Full Netherite!`)}`,
          `Custom : ${mono(`${p}ach Challenge Complete! | Kalahkan Warden`)}`,
          `Stiker : ${mono(`${p}sach Kena Ledakan Creeper`)} (atau reply chat teman)`,
          `Ikon   : ${mono('diamond, creeper, pedang, apel, rumput, mahkota')}`,
        ])
      );
      return;
    }

    let title = 'Achievement Get!';
    let description = rawContent;
    if (rawContent.includes('|')) {
      const parts = rawContent.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        title = parts[0];
        description = parts.slice(1).join(' — ');
      }
    }

    const challenge = /challenge|tantangan|legend|epic|ssr|sultan/i.test(title);

    try {
      if (sendAsSticker) {
        const stickerBuf = await renderAchievementSticker({
          title,
          description,
          icon,
          challenge,
          packName: config.sticker?.packName || config.botName,
          author: config.sticker?.author || pushName || config.ownerName,
        });
        await sock.sendMessage(chatJid, { sticker: stickerBuf }, { quoted: msg });
        return;
      }

      const pngBuf = await renderMinecraftAchievementCard({
        title,
        description,
        icon,
        challenge,
      });

      await sock.sendMessage(
        chatJid,
        {
          image: pngBuf,
          caption: `🏆 *${boldSans(title)}* — ${description}`,
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:ACH', 'Gagal merender kartu/stiker .ach', err);
      await ctx.reply(
        formatError('Gagal Membuat Achievement', [
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
