const config = require('../../config');
const { getRandomAnimeQuote } = require('../../lib/kawaii');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'quotes',
  alias: ['quote', 'kutipan', 'kataanime'],
  category: 'fun',
  description: 'Kutipan bijak & menyentuh hati dari karakter Anime pilihan',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, prefix } = ctx;
    const item = getRandomAnimeQuote();

    await sendButtons(sock, chatJid, {
      title: '❖ Kutipan Anime Pilihan ❖',
      text: renderBox(
        '💬 ǫᴜᴏᴛᴇs ᴀɴɪᴍᴇ ʜᴀʀɪ ɪɴɪ',
        [
          `"${item.quote}"`,
          '',
          `✦ Tokoh : ${keep(item.char)}`,
          `✦ Anime : ${keep(item.anime)}`,
        ],
        { footer: config.footer }
      ),
      footer: config.footer,
      ownerJid: senderJid,
      isPublic: true,
      quoted: msg,
      buttons: [
        { id: `${prefix}quotes`, text: '🌸 Kutipan Lainnya' },
        { id: `${prefix}ramalan`, text: '⛩️ Ramalan Hari Ini' },
      ],
    });
  },
};
