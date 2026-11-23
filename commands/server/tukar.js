const config = require('../../config');
const {
  getLinkedAccountDetails,
  redeemCoinsForMcReward,
} = require('../../lib/bridge');
const { getEconomy } = require('../../lib/economy');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'tukar',
  alias: ['redeem', 'tukarpoin', 'klaimmc'],
  category: 'server',
  description: 'Tukar Sakura Coin chat WA menjadi hadiah item in-game Minecraft (berkuota harian)',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, args } = ctx;
    const p = config.prefix;
    const linkInfo = getLinkedAccountDetails(senderJid);

    if (!linkInfo || linkInfo.status !== 'verified') {
      await ctx.reply(
        formatError('Akun Minecraft Belum Tertaut', [
          `Kamu harus menautkan & memverifikasi akun Minecraft dulu sebelum menukar hadiah ♡`,
          `Ketik ${mono(`${p}link <username>`)} (atau ${mono(`${p}link ${config.minecraft.bedrockPrefix}NamaBedrock`)} untuk Bedrock) ya!`,
        ])
      );
      return;
    }

    const catalog = config.minecraft.rewards || {};
    const entries = Object.entries(catalog);
    const chosenKey = (args[0] || '').toLowerCase().trim();

    if (!chosenKey) {
      const wallet = getEconomy(senderJid);
      const lines = [
        `✦ Akun Tujuan : ${keep(linkInfo.mcUsername)} ${linkInfo.isBedrock ? '[BE]' : '[Java]'}`,
        `✦ Saldo Kamu  : ${formatNumber(wallet.balance)} ${config.economy.currencyName}`,
        `✦ Kuota Hari  : ${linkInfo.dailyRewardRemaining}/${linkInfo.dailyRewardMax} penukaran (reset 00:00 WIB)`,
        '',
        '❖ Daftar Paket Hadiah In-Game:',
      ];

      for (const [key, item] of entries) {
        lines.push(
          `◦ ${mono(`${p}tukar ${key}`)} — ${keep(item.label)} (${formatNumber(item.cost)} koin)`
        );
      }

      lines.push('');
      lines.push('◦ Pastikan karaktermu sedang online di dalam server saat menukar hadiah ya ♡');

      const menuBox = renderBox('✿ ᴛᴜᴋᴀʀ ᴋᴏɪɴ ᴋᴇ ᴍɪɴᴇᴄʀᴀꜰᴛ', lines, {
        footer: config.footer,
      });

      const selectRows = entries.map(([key, item]) => ({
        title: `${item.label} (${formatNumber(item.cost)} Koin)`,
        description: item.description || `Kirim ke ${linkInfo.mcUsername}`,
        command: `${p}tukar ${key}`,
      }));

      await ctx.replyCard(null, menuBox, {
        title: '❖ Toko Penukaran In-Game ❖',
        buttons: [
          {
            type: 'single_select',
            title: '✿ Pilih Paket Hadiah',
            sections: [
              {
                title: 'Paket Item Minecraft CipiSMP',
                rows: selectRows,
              },
            ],
          },
          {
            command: `${p}akun`,
            text: '✦ Info Akun MC',
          },
        ],
      });
      return;
    }

    const res = await redeemCoinsForMcReward(senderJid, chosenKey);
    if (!res.ok) {
      if (res.reason === 'invalid_reward') {
        await ctx.reply(
          formatError('Paket Tidak Ditemukan', [
            `Kode paket ${mono(chosenKey)} tidak tersedia.`,
            `Ketik ${mono(`${p}tukar`)} tanpa argumen untuk melihat daftar paket lengkap ya ♡`,
          ])
        );
        return;
      }
      if (res.reason === 'daily_limit_reached') {
        await ctx.reply(
          formatError('Batas Penukaran Harian Habis', [
            `Kamu sudah mencapai batas maksimal ${res.maxDaily}x penukaran hari ini ♡`,
            'Kuota akan direset otomatis pukul 00:00 WIB!',
          ])
        );
        return;
      }
      if (res.reason === 'insufficient_balance') {
        await ctx.reply(
          formatError('Sakura Coin Belum Cukup', [
            `Harga paket ini ${formatNumber(res.cost)} koin, sedangkan saldomu ${formatNumber(res.balance)} koin ♡`,
            `Yuk kumpulkan koin lewat ${mono(`${p}daily`)}, ${mono(`${p}kerja`)}, atau mengobrol aktif di grup!`,
          ])
        );
        return;
      }

      await ctx.reply(
        formatError('Pengiriman Item Gagal (Koin Utuh)', [
          'Server Minecraft sedang tidak dapat menerima perintah saat ini.',
          `Tenang saja, Sakura Coin kamu otomatis dikembalikan 100% utuh ♡`,
          res.error ? `Detail: ${keep(res.error)}` : '',
        ].filter(Boolean))
      );
      return;
    }

    await ctx.reply(
      formatSuccess('Penukaran Hadiah Berhasil!', [
        res.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
        `✦ Penerima    : ${keep(res.mcUsername)} ${res.isBedrock ? '[BE]' : '[Java]'}`,
        `✦ Hadiah      : ${keep(res.rewardLabel)}`,
        `✦ Biaya       : -${formatNumber(res.cost)} ${config.economy.currencyName}`,
        `✦ Sisa Saldo  : ${formatNumber(res.newBalance)} ${config.economy.currencyName}`,
        `✦ Sisa Kuota  : ${res.remainingDaily}/${res.maxDaily} hari ini`,
        `◦ Dikirim via : ${keep(res.via)} ♡`,
      ].filter(Boolean))
    );
  },
};
