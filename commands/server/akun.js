const config = require('../../config');
const { getLinkedAccountDetails } = require('../../lib/bridge');
const { getEconomy } = require('../../lib/economy');
const { renderBox, mono, keep } = require('../../lib/smallcaps');
const { getWibParts, formatNumber } = require('../../lib/logger');

function formatPlaytime(minutes = 0) {
  const m = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(m / 60);
  const rem = m % 60;
  if (hours === 0) return `${rem} menit`;
  return `${hours} jam ${rem} menit`;
}

module.exports = {
  name: 'akun',
  alias: ['mcprofile', 'akunmc', 'myaccount'],
  category: 'server',
  description: 'Lihat status akun Minecraft tertaut, edisi Java/Bedrock, dan kuota .tukar',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid } = ctx;
    const p = config.prefix;
    const details = getLinkedAccountDetails(senderJid);

    if (!details) {
      const emptyBox = renderBox(
        '❖ sᴛᴀᴛᴜs ᴀᴋᴜɴ ᴍɪɴᴇᴄʀᴀꜰᴛ',
        [
          '✦ Status    : Belum Tertaut ❌',
          `✦ Java      : Ketik ${mono(`${p}link NamaJava`)}`,
          `✦ Bedrock   : Ketik ${mono(`${p}link ${config.minecraft.bedrockPrefix}NamaBedrock`)}`,
          '',
          '◦ Tautkan akunmu agar bisa tukar Sakura Coin ke hadiah item in-game ♡',
        ],
        { footer: config.footer }
      );
      await ctx.reply(emptyBox);
      return;
    }

    const wallet = getEconomy(senderJid);
    const editionStr = details.isBedrock ? 'Bedrock / Geyser [BE]' : 'Java Edition';
    const statusStr =
      details.status === 'verified'
        ? 'Terverifikasi ✅'
        : 'Menunggu Verifikasi ⏳';

    const lines = [
      `✦ Username   : ${keep(details.mcUsername)}`,
      `✦ Edisi      : ${keep(editionStr)}`,
      `✦ Status     : ${statusStr}`,
      details.linkedAt
        ? `✦ Tertaut    : ${keep(getWibParts(new Date(details.linkedAt)).timestamp)}`
        : '',
      `✦ Jam Main   : ${formatPlaytime(details.playtimeMinutes)}`,
      `✦ Saldo Koin : ${formatNumber(wallet.balance)} ${config.economy.currencyName}`,
      `✦ Kuota Tukar: ${details.dailyRewardRemaining}/${details.dailyRewardMax} tersisa hari ini (reset 00:00 WIB)`,
    ].filter(Boolean);

    const box = renderBox('✿ ᴀᴋᴜɴ ᴍɪɴᴇᴄʀᴀꜰᴛ ᴛᴇʀᴛᴀᴜᴛ', lines, {
      footer: config.footer,
    });

    await ctx.replyCard(null, box, {
      title: `❖ ${details.mcUsername} ❖`,
      buttons:
        details.status === 'verified'
          ? [
              { command: `${p}tukar`, text: '✿ Tukar Hadiah MC' },
              { command: `${p}unlink`, text: '❖ Lepas Tautan' },
            ]
          : [
              { command: `${p}unlink`, text: '❌ Batalkan Verifikasi' },
            ],
    });
  },
};
