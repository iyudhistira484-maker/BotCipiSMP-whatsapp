const config = require('../../config');
const { drawDailyFortune } = require('../../lib/kawaii');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'ramalan',
  alias: ['omikuji', 'hoki', 'fortune', 'zodiak'],
  category: 'fun',
  description: 'Tarik kertas Omikuji Ramalan Harian Kuil Sakura + berkah koin harian',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, prefix } = ctx;
    const res = drawDailyFortune(senderJid);

    const lines = [
      `✦ Petualang    : ${keep(pushName || 'Sahabat Cipi')}`,
      `✦ Tanggal WIB  : ${keep(res.today)}`,
      `✦ Tingkat Hoki : ${res.grade}`,
      `✦ Bintang      : ${res.stars}`,
      `✦ Angka Hoki   : ${res.luckyNumber} | Warna: ${res.color}`,
      '',
      `❖ Pesan Persahabatan & Hati:`,
      `  "${res.love}"`,
      '',
      `❖ Hoki Petualangan Minecraft:`,
      `  "${res.mcLuck}"`,
    ];

    if (res.grantedBonus > 0) {
      lines.push(
        '',
        `🌸 Berkah Kuil Hari Ini: +${formatNumber(res.grantedBonus)} ${config.economy.currencyName} ditambahkan ke dompetmu!`
      );
    } else {
      lines.push(
        '',
        `◦ Berkah koin kuil hari ini sudah kamu terima, kembali lagi besok pukul 00:00 WIB ya ♡`
      );
    }

    await sendButtons(sock, chatJid, {
      title: '❖ Omikuji Kuil Sakura ❖',
      text: renderBox('⛩️ ʀᴀᴍᴀʟᴀɴ ʜᴀʀɪᴀɴ ᴏᴍɪᴋᴜᴊɪ', lines, {
        footer: config.footer,
      }),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}gacha 1`, text: '🌸 Uji Hoki Gacha' },
        { id: `${prefix}quotes`, text: '💬 Kutipan Anime' },
      ],
    });
  },
};
