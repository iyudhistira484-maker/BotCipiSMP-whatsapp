const config = require('../../config');
const {
  startQuizSession,
  getActiveGameSession,
  forfeitActiveGameSession,
  checkGameAnswer,
} = require('../../lib/kawaii');
const { sendButtons } = require('../../lib/buttons');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  keep,
  mono,
} = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'kuis',
  alias: ['quiz', 'trivia', 'cerdascermat'],
  category: 'fun',
  description: 'Kuis Trivia interaktif (Minecraft, Anime, & Umum) berhadiah Sakura Coin + XP',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, prefix, reply } = ctx;
    const sub = String(args[0] || '').toLowerCase().trim();

    // 1. Minta Petunjuk (.kuis hint / bantuan)
    if (sub === 'hint' || sub === 'bantuan' || sub === 'clue') {
      const active = getActiveGameSession(chatJid);
      if (!active || active.type !== 'kuis') {
        return reply(
          formatWarning('Belum Ada Kuis Aktif', [
            `✦ Mulai kuis baru dengan mengetik ${mono(`${prefix}kuis`)}!`,
          ])
        );
      }
      return reply(
        renderBox('💡 ᴘᴇᴛᴜɴᴊᴜᴋ ᴋᴜɪs', [
          `✦ Pertanyaan : ${active.question}`,
          `✦ Petunjuk   : ${active.hint}`,
          `◦ Ketik langsung jawabanmu di chat!`,
        ])
      );
    }

    // 2. Menyerah (.kuis nyerah)
    if (sub === 'nyerah' || sub === 'skip' || sub === 'batal') {
      const ended = forfeitActiveGameSession(chatJid);
      if (!ended || ended.type !== 'kuis') {
        return reply(
          formatWarning('Belum Ada Kuis Aktif', [
            `✦ Mulai kuis baru dengan ${mono(`${prefix}kuis`)}!`,
          ])
        );
      }
      return sendButtons(sock, chatJid, {
        title: '❖ Sesi Kuis Selesai ❖',
        text: renderBox('🏳️ ᴋᴜɪs ᴅɪʜᴇɴᴛɪᴋᴀɴ', [
          `✦ Jawaban yang benar adalah: ${keep(ended.displayAnswer)}`,
          `◦ Jangan patah semangat, coba soal berikutnya yuk!`,
        ]),
        footer: config.footer,
        ownerJid: senderJid,
        isPublic: true,
        quoted: msg,
        buttons: [{ id: `${prefix}kuis`, text: '🧠 Soal Baru' }],
      });
    }

    // 3. Jika ada argumen jawaban & ada kuis aktif -> cek jawaban via command juga!
    const existing = getActiveGameSession(chatJid);
    if (existing && existing.type === 'kuis' && args.length > 0 && sub !== 'mulai') {
      const attempt = args.join(' ');
      const check = checkGameAnswer(chatJid, senderJid, attempt);
      if (check.matched) {
        return reply(
          formatSuccess('Jawaban Tepat Sekali! 🎉', [
            `✦ Jawaban  : ${keep(check.displayAnswer)}`,
            `✦ Hadiah   : +${formatNumber(check.rewardCoins)} ${config.economy.currencyName} & +${check.rewardXp} XP`,
            `◦ Saldo Sekarang: ${formatNumber(check.newBalance)} ${config.economy.currencyName} ♡`,
          ])
        );
      }
      return reply(
        formatWarning('Kurang Tepat~', [
          `✦ Jawaban "${keep(attempt)}" belum tepat nih!`,
          `◦ Coba lagi atau ketik ${mono(`${prefix}kuis hint`)} untuk petunjuk.`,
        ])
      );
    }

    // 4. Mulai Sesi Kuis Baru (.kuis)
    const started = startQuizSession(chatJid, 45000);
    if (!started.ok) {
      const cur = started.existing;
      const secsLeft = Math.max(1, Math.ceil((cur.expiresAt - Date.now()) / 1000));
      return reply(
        formatWarning('Masih Ada Game Aktif di Chat Ini!', [
          cur.type === 'kuis'
            ? `✦ Soal Aktif : ${cur.question}`
            : `✦ Masih berlangsung sesi Tebak Gambar (${secsLeft} detik tersisa)!`,
          `◦ Ketik langsung jawabanmu di chat atau akhiri dengan ${mono(`${prefix}${cur.type} nyerah`)}.`,
        ])
      );
    }

    const s = started.session;
    await sendButtons(sock, chatJid, {
      title: `❖ Kuis ${keep(s.category)} ❖`,
      text: renderBox(
        '🧠 ᴋᴜɪs ᴄᴇʀᴅᴀs ᴄɪᴘɪsᴍᴘ',
        [
          `✦ Kategori : ${keep(s.category)}`,
          `✦ Soal     : ${s.question}`,
          `✦ Hadiah   : +${s.rewardCoins} ${config.economy.currencyName} & +${s.rewardXp} XP`,
          `✦ Waktu    : 45 Detik`,
          '',
          `◦ Ketik langsung jawabanmu di chat tanpa perlu prefix!`,
        ],
        { footer: config.footer }
      ),
      footer: config.footer,
      ownerJid: senderJid,
      isPublic: true,
      quoted: msg,
      buttons: [
        { id: `${prefix}kuis hint`, text: '💡 Petunjuk' },
        { id: `${prefix}kuis nyerah`, text: '🏳️ Menyerah' },
      ],
    });
  },
};
