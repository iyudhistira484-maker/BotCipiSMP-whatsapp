const config = require('../../config');
const { spinKawaiiSlot } = require('../../lib/kawaii');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, formatWarning, keep, mono } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'slot',
  alias: ['slots', 'jackpot', 'mesinslot'],
  category: 'fun',
  description: 'Putar Mesin Slot Kawaii 3-Reel menggunakan Sakura Coin (Min 50, Maks 2.500)',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, prefix, reply } = ctx;
    const betInput = args[0] ? Number(args[0]) : 100;

    const res = spinKawaiiSlot(senderJid, betInput);
    if (!res.ok) {
      if (res.reason === 'insufficient_balance') {
        return reply(
          formatWarning('Saldo Sakura Coin Kurang 🌸', [
            `✦ Taruhan Slot : ${formatNumber(res.bet)} ${config.economy.currencyName}`,
            `✦ Saldo Kamu   : ${formatNumber(res.balance)} ${config.economy.currencyName}`,
            `◦ Klaim ${mono(`${prefix}daily`)} atau ${mono(`${prefix}kerja`)} dulu yuk~`,
          ])
        );
      }
      return reply(
        formatWarning('Nominal Taruhan Tidak Valid', [
          `✦ Masukkan nominal antara 50 hingga 2.500 ${config.economy.currencyName}.`,
          `✦ Contoh: ${mono(`${prefix}slot 150`)}`,
        ])
      );
    }

    const reelDisplay = `⟦  ${res.reels[0]}  │  ${res.reels[1]}  │  ${res.reels[2]}  ⟧`;

    let statusTitle = '🍃 ʙᴇʟᴜᴍ ʙᴇʀᴜɴᴛᴜɴɢ~';
    let detailLine = `✦ Hasil   : Belum cocok (-${formatNumber(res.bet)} ${config.economy.currencyName})`;

    if (res.winType === 'jackpot') {
      statusTitle = '🎊 ᴊᴀᴄᴋᴘᴏᴛ 3 sɪᴍʙᴏʟ ᴋᴇᴍʙᴀʀ!!';
      detailLine = `✦ Hadiah  : +${formatNumber(res.payout)} ${config.economy.currencyName} (x${res.multiplier}!) ✨`;
    } else if (res.winType === 'pair') {
      statusTitle = '🌸 ᴍᴀɴɪs! 2 sɪᴍʙᴏʟ ᴋᴇᴍʙᴀʀ!';
      detailLine = `✦ Hadiah  : +${formatNumber(res.payout)} ${config.economy.currencyName} (x${res.multiplier})`;
    }

    await sendButtons(sock, chatJid, {
      title: '❖ Mesin Slot Sakura ❖',
      text: renderBox(
        statusTitle,
        [
          `      ${keep(reelDisplay)}`,
          '',
          `✦ Taruhan : ${formatNumber(res.bet)} ${config.economy.currencyName}`,
          detailLine,
          `◦ Saldo   : ${formatNumber(res.newBalance)} ${config.economy.currencyName}`,
        ],
        { footer: config.footer }
      ),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}slot 100`, text: '🎰 Putar 100' },
        { id: `${prefix}slot 250`, text: '🎰 Putar 250' },
        { id: `${prefix}dompet`, text: '👛 Cek Dompet' },
      ],
    });
  },
};
