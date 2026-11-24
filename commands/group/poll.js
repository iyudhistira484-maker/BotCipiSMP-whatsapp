const config = require('../../config');
const { ensureGroup } = require('../../lib/database');
const { detectDisallowedLink } = require('../../lib/group-guard');
const { formatError, mono, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

function parsePollInput(rawText = '') {
  let working = String(rawText || '').trim();
  let multiSelect = false;

  const firstToken = (working.split(/\s+/)[0] || '').toLowerCase();
  if (firstToken === 'multi' || firstToken === 'banyak' || firstToken === '-m') {
    multiSelect = true;
    working = working.slice(firstToken.length).trim();
  }

  let segments = [];
  if (working.includes('|')) {
    segments = working.split('|');
  } else if (working.includes('\n')) {
    segments = working.split(/\r?\n/);
  } else if (working.includes(' / ')) {
    segments = working.split(' / ');
  } else if (working) {
    segments = [working];
  }

  const cleaned = segments
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return null;
  }

  const question = cleaned[0].slice(0, 220);
  let rawOptions = cleaned.slice(1);

  // Jika user hanya mengetik pertanyaan tanpa opsi, otomatis buat voting Setuju / Tidak Setuju!
  if (rawOptions.length === 0) {
    rawOptions = ['Setuju', 'Tidak Setuju'];
  } else if (rawOptions.length === 1) {
    rawOptions = [rawOptions[0], 'Lainnya / Tidak'];
  }

  // Deduplikasi opsi & batasi maksimal 12 sesuai batas protokol WhatsApp Poll
  const seen = new Set();
  const options = [];
  for (const opt of rawOptions) {
    const trimmedOpt = opt.slice(0, 100);
    const key = trimmedOpt.toLowerCase();
    if (!trimmedOpt || seen.has(key)) continue;
    seen.add(key);
    options.push(trimmedOpt);
    if (options.length >= 12) break;
  }

  if (options.length < 2) {
    options.push('Tidak Setuju');
  }

  return {
    question,
    options,
    selectableCount: multiSelect ? 0 : 1,
  };
}

module.exports = {
  name: 'poll',
  alias: ['voting', 'vote', 'polling'],
  category: 'group',
  description: 'Buat voting/polling interaktif WhatsApp asli untuk diskusi komunitas CipiSMP',
  cooldown: 12,
  groupOnly: true,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      msg,
      chatJid,
      isOwner: senderIsOwner,
      isAdmin,
      isBotAdmin,
      text,
    } = ctx;
    const p = config.prefix || '.';

    const parsed = parsePollInput(text);
    if (!parsed) {
      await ctx.reply(
        formatError('Format Voting / Poll', [
          `Cepat (Setuju/Tidak) : ${mono(`${p}poll Malam ini event Boss Fight?`)}`,
          `Pilihan kustom       : ${mono(`${p}poll Event malam ini? | PvP | Parkour | Hide & Seek`)}`,
          `Pilihan ganda        : ${mono(`${p}poll multi Fitur favorit? | Gacha | Ekonomi | Mabar`)}`,
        ])
      );
      return;
    }

    // Cegah penyelundupan tautan luar lewat polling saat Antilink grup aktif
    if (!senderIsOwner && !isAdmin) {
      const groupRow = ensureGroup(chatJid);
      if (groupRow?.antilink) {
        const combined = `${parsed.question} ${parsed.options.join(' ')}`;
        const badLink = await detectDisallowedLink(sock, chatJid, combined, isBotAdmin, {
          allowDownloaderCmd: false,
        });
        if (badLink) {
          await ctx.reply(
            formatError('Tautan Tidak Diizinkan', [
              'Teks maupun opsi voting tidak boleh berisi tautan luar saat Antilink grup aktif.',
            ])
          );
          return;
        }
      }
    }

    try {
      await sock.sendMessage(
        chatJid,
        {
          poll: {
            name: parsed.question,
            values: parsed.options,
            selectableCount: parsed.selectableCount,
          },
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:POLL', 'Gagal mengirim WhatsApp Poll', err);
      await ctx.reply(
        formatError('Gagal Membuat Polling', [
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
