const config = require('../../config');
const {
  SAFE_ANIME_CATEGORIES,
  fetchRandomAnimeImage,
} = require('../../lib/api');
const { renderBox, formatError, keep, mono } = require('../../lib/smallcaps');

module.exports = {
  name: 'anime',
  alias: ['waifu', 'neko', 'shinobu', 'megumin', 'randomanime'],
  category: 'kawaii',
  description: 'Kirim gambar anime kawaii acak (waifu/neko/shinobu/megumin/hug/pat)',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { commandName, args } = ctx;
    const p = config.prefix;

    const requestedCat =
      commandName !== 'anime' && commandName !== 'randomanime'
        ? commandName
        : (args[0] || 'waifu').toLowerCase();

    const availableCats = Object.keys(SAFE_ANIME_CATEGORIES);
    if (args[0] && args[0].toLowerCase() === 'list') {
      await ctx.reply(
        renderBox('✿ ᴋᴀᴛᴇɢᴏʀɪ ɢᴀᴍʙᴀʀ ᴀɴɪᴍᴇ', [
          `✦ Pilihan: ${availableCats.map((c) => mono(`${p}anime ${c}`)).join(', ')}`,
        ])
      );
      return;
    }

    const res = await fetchRandomAnimeImage(requestedCat);
    if (!res.ok) {
      await ctx.reply(
        formatError('Gagal Mengambil Gambar', [
          'Semua galeri anime sedang sibuk nih kak, coba sebentar lagi ya ♡',
        ])
      );
      return;
    }

    const caption = renderBox(
      `✿ ɢᴀʟᴇʀɪ ᴀɴɪᴍᴇ • ${res.category}`,
      [
        res.artist ? `✦ Ilustrator : ${keep(res.artist)}` : '✦ Semoga harimu makin cerah ya ♡',
        `◦ Sumber     : ${keep(res.provider)}`,
      ],
      { footer: config.footer }
    );

    await ctx.replyCard(res.buffer, caption, {
      title: `✿ Anime ${res.category} ✿`,
      buttons: [
        {
          command: `${p}anime ${res.category}`,
          text: `✿ ${res.category} Lagi`,
        },
        {
          command: `${p}anime ${res.category === 'neko' ? 'waifu' : 'neko'}`,
          text: res.category === 'neko' ? '♡ Coba Waifu' : '♡ Coba Neko',
        },
      ],
    });
  },
};
