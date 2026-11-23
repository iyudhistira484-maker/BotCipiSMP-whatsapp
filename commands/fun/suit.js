const config = require('../../config');
const { playRockPaperScissors } = require('../../lib/kawaii');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, formatWarning, keep, mono } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'suit',
  alias: ['janken', 'rps', 'batuguntingkertas'],
  category: 'fun',
  description: 'Adu Suit (Batu, Gunting, Kertas) melawan CipiBot dengan opsi taruhan koin',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, prefix, reply } = ctx;
    const choiceArg = String(args[0] || '').toLowerCase().trim();
    const betArg = Number(args[1] || 0);

    if (!choiceArg) {
      return sendButtons(sock, chatJid, {
        title: '❖ Janken / Suit CipiSMP ❖',
        text: renderBox(
          '✂️ ᴀᴅᴜ sᴜɪᴛ ʟᴀᴡᴀɴ ᴄɪᴘɪʙᴏᴛ',
          [
            '✦ Pilih tanganmu untuk beradu suit dengan CipiBot!',
            `✦ Mode Santai : ${mono(`${prefix}suit batu`)} (Menang dapat +35 Koin!)`,
            `✦ Mode Taruhan: ${mono(`${prefix}suit gunting 200`)} (Maks 2.000 Koin)`,
          ],
          { footer: config.footer }
        ),
        footer: config.footer,
        ownerJid: senderJid,
        quoted: msg,
        buttons: [
          { id: `${prefix}suit batu`, text: '🪨 Batu' },
          { id: `${prefix}suit gunting`, text: '✂️ Gunting' },
          { id: `${prefix}suit kertas`, text: '📄 Kertas' },
        ],
      });
    }

    const res = playRockPaperScissors(senderJid, choiceArg, betArg);
    if (!res.ok) {
      if (res.reason === 'insufficient_balance') {
        const kurang = Math.max(0, Number(res.bet || 0) - Number(res.balance || 0));
        return reply(
          formatWarning('Saldo Tidak Cukup', [
            `✦ Taruhan : ${formatNumber(res.bet)} ${config.economy.currencyName}`,
            `✦ Saldo   : ${formatNumber(res.balance)} ${config.economy.currencyName} (kurang ${formatNumber(kurang)} koin)`,
            `◦ Klaim ${mono(`${prefix}daily`)} atau ${mono(`${prefix}kerja`)} dulu yuk!`,
          ])
        );
      }
      return reply(
        formatWarning('Pilihan Tangan Belum Tepat', [
          `✦ Pilih salah satu: ${mono('batu')}, ${mono('gunting')}, atau ${mono('kertas')}!`,
          `✦ Contoh: ${mono(`${prefix}suit kertas 150`)}`,
        ])
      );
    }

    const headerMap = {
      win: '🎉 ᴋᴀᴍᴜ ᴍᴇɴᴀɴɢ sᴜɪᴛ!',
      lose: '😿 ʏᴀʜ, ᴄɪᴘɪʙᴏᴛ ᴍᴇɴᴀɴɢ~',
      draw: '🤝 ʜᴀsɪʟ sᴇʀɪ (ᴅʀᴀᴡ)!',
    };

    const deltaLine =
      res.coinDelta > 0
        ? `✦ Hadiah  : +${formatNumber(res.coinDelta)} ${config.economy.currencyName} ✨`
        : res.coinDelta < 0
        ? `✦ Taruhan : -${formatNumber(Math.abs(res.coinDelta))} ${config.economy.currencyName}`
        : '✦ Koin    : Tetap utuh (0)';

    const suffixBet = res.bet > 0 ? ` ${res.bet}` : '';

    await sendButtons(sock, chatJid, {
      title: '❖ Hasil Suit CipiSMP ❖',
      text: renderBox(
        headerMap[res.outcome],
        [
          `✦ Pilihanmu : ${keep(res.userLabel)}`,
          `✦ CipiBot   : ${keep(res.botLabel)}`,
          deltaLine,
          `◦ Saldo Kini: ${formatNumber(res.newBalance)} ${config.economy.currencyName}`,
        ],
        { footer: config.footer }
      ),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}suit batu${suffixBet}`, text: '🪨 Batu Lagi' },
        { id: `${prefix}suit gunting${suffixBet}`, text: '✂️ Gunting Lagi' },
        { id: `${prefix}suit kertas${suffixBet}`, text: '📄 Kertas Lagi' },
      ],
    });
  },
};
