const config = require('../../config');
const {
  startTebakGambarSession,
  getActiveGameSession,
  forfeitActiveGameSession,
  checkGameAnswer,
} = require('../../lib/kawaii');
const { renderTebakGambarCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  keep,
  mono,
} = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'tebakgambar',
  alias: ['tg', 'rebus', 'tebak'],
  category: 'fun',
  description: 'Game Tebak Gambar / Rebus Visual berhadiah Sakura Coin + XP',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, prefix, reply } = ctx;
    const sub = String(args[0] || '').toLowerCase().trim();

    // 1. Petunjuk (.tebakgambar hint)
    if (sub === 'hint' || sub === 'bantuan' || sub === 'clue') {
      const active = getActiveGameSession(chatJid);
      if (!active || active.type !== 'tebakgambar') {
        return reply(
          formatWarning('Belum Ada Tebak Gambar Aktif', [
            `✦ Mulai permainan baru dengan ${mono(`${prefix}tebakgambar`)}!`,
          ])
        );
      }
      return reply(
        renderBox('💡 ᴘᴇᴛᴜɴᴊᴜᴋ ᴛᴇʙᴀᴋ ɢᴀᴍʙᴀʀ', [
          `✦ Petunjuk Visual : ${keep(active.clues.join(' '))}`,
          `✦ Arti / Makna    : ${active.hint}`,
          `◦ Ketik langsung jawabannya di chat ya!`,
        ])
      );
    }

    // 2. Menyerah (.tebakgambar nyerah)
    if (sub === 'nyerah' || sub === 'skip' || sub === 'batal') {
      const ended = forfeitActiveGameSession(chatJid);
      if (!ended || ended.type !== 'tebakgambar') {
        return reply(
          formatWarning('Belum Ada Tebak Gambar Aktif', [
            `✦ Mulai ronde baru dengan ${mono(`${prefix}tebakgambar`)}!`,
          ])
        );
      }
      return sendButtons(sock, chatJid, {
        title: '❖ Tebak Gambar Selesai ❖',
        text: renderBox('🏳️ ʀᴏɴᴅᴇ ᴅɪʜᴇɴᴛɪᴋᴀɴ', [
          `✦ Jawaban yang benar adalah: ${keep(ended.displayAnswer)}`,
          `◦ Coba kartu berikutnya yuk!`,
        ]),
        footer: config.footer,
        ownerJid: senderJid,
        isPublic: true,
        quoted: msg,
        buttons: [{ id: `${prefix}tebakgambar`, text: '🎨 Kartu Baru' }],
      });
    }

    // 3. Cek jawaban via argumen command jika sesi aktif
    const existing = getActiveGameSession(chatJid);
    if (existing && existing.type === 'tebakgambar' && args.length > 0 && sub !== 'mulai') {
      const attempt = args.join(' ');
      const check = checkGameAnswer(chatJid, senderJid, attempt);
      if (check.matched) {
        return reply(
          formatSuccess('Tebakanmu Jitu Sekali! 🎉', [
            `✦ Jawaban  : ${keep(check.displayAnswer)}`,
            `✦ Hadiah   : +${formatNumber(check.rewardCoins)} ${config.economy.currencyName} & +${check.rewardXp} XP`,
            `◦ Saldo Sekarang: ${formatNumber(check.newBalance)} ${config.economy.currencyName} ♡`,
          ])
        );
      }
      return reply(
        formatWarning('Belum Tepat~', [
          `✦ Tebakan "${keep(attempt)}" masih kurang pas!`,
          `◦ Ketik ${mono(`${prefix}tebakgambar hint`)} bila butuh bantuan.`,
        ])
      );
    }

    // 4. Mulai Sesi Tebak Gambar Baru
    const started = startTebakGambarSession(chatJid, 60000);
    if (!started.ok) {
      const cur = started.existing;
      const secsLeft = Math.max(1, Math.ceil((cur.expiresAt - Date.now()) / 1000));
      return reply(
        formatWarning('Masih Ada Game Aktif di Chat Ini!', [
          `✦ Sesi ${keep(cur.type.toUpperCase())} masih berjalan (${secsLeft} detik tersisa).`,
          `◦ Ketik langsung jawabanmu di chat atau akhiri dengan ${mono(`${prefix}${cur.type} nyerah`)}.`,
        ])
      );
    }

    const s = started.session;
    let cardBuffer = null;
    try {
      cardBuffer = await renderTebakGambarCard({
        clues: s.clues,
        category: s.category,
        answerMask: s.answerMask,
        rewardCoins: s.rewardCoins,
      });
    } catch (err) {
      logger.error('CMD:TEBAKGAMBAR', 'Gagal merender kartu tebak gambar, memakai fallback teks', err);
    }

    const caption = renderBox(
      '🎨 ᴛᴇʙᴀᴋ ɢᴀᴍʙᴀʀ ʀᴇʙᴜs',
      [
        `✦ Kategori : ${keep(s.category)}`,
        `✦ Susunan  : ${keep(s.clues.join('  '))}`,
        `✦ Pola     : ${keep(s.answerMask)}`,
        `✦ Hadiah   : +${s.rewardCoins} ${config.economy.currencyName} & +${s.rewardXp} XP`,
        `✦ Waktu    : 60 Detik`,
        '',
        `◦ Ketik langsung jawabanmu di chat!`,
      ],
      { footer: config.footer }
    );

    await sendButtons(sock, chatJid, {
      title: '❖ Tebak Gambar CipiSMP ❖',
      text: caption,
      footer: config.footer,
      image: cardBuffer,
      ownerJid: senderJid,
      isPublic: true,
      quoted: msg,
      buttons: [
        { id: `${prefix}tebakgambar hint`, text: '💡 Petunjuk' },
        { id: `${prefix}tebakgambar nyerah`, text: '🏳️ Menyerah' },
      ],
    });
  },
};
