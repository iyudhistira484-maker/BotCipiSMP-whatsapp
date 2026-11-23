const config = require('../../config');
const { getUserProfile } = require('../../lib/database');
const { getEconomy } = require('../../lib/economy');
const {
  PROFILE_SHOP_ITEMS,
  buyOrEquipShopItem,
  getUserOwnedShopIds,
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
  name: 'toko',
  alias: ['shop', 'butik', 'tokoprofil'],
  category: 'kawaii',
  description: 'Toko kustomisasi Kartu Profil (Background, Bingkai, & Gelar Kustom)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, args, prefix, reply } = ctx;
    const sub = String(args[0] || '').toLowerCase().trim();

    // Beli atau Pasang item (.toko beli <kode> / .toko pakai <kode> / .toko <kode>)
    const targetCode =
      sub === 'beli' || sub === 'buy' || sub === 'pakai' || sub === 'equip'
        ? String(args[1] || '').toLowerCase().trim()
        : PROFILE_SHOP_ITEMS[sub]
        ? sub
        : '';

    if (targetCode) {
      const res = buyOrEquipShopItem(senderJid, targetCode);
      if (!res.ok) {
        if (res.reason === 'insufficient_balance') {
          return reply(
            formatWarning('Sakura Coin Belum Cukup 🌸', [
              `✦ Item  : ${keep(res.item.name)}`,
              `✦ Harga : ${formatNumber(res.cost)} ${config.economy.currencyName}`,
              `✦ Saldo : ${formatNumber(res.balance)} ${config.economy.currencyName}`,
              `◦ Yuk kumpulkan koin lewat ${mono(`${prefix}daily`)}, ${mono(`${prefix}kerja`)}, atau ${mono(`${prefix}quest`)}!`,
            ])
          );
        }
        return reply(
          formatWarning('Kode Item Tidak Ditemukan', [
            `✦ Cek daftar kode lengkap di ${mono(`${prefix}toko`)} ya!`,
          ])
        );
      }

      const statusMsg = res.alreadyOwned
        ? 'Item Sudah Dimiliki & Langsung Dipasang! ✨'
        : 'Pembelian Berhasil & Langsung Dipasang! 🛍️';

      return sendButtons(sock, chatJid, {
        title: '❖ Butik Sakura CipiSMP ❖',
        text: formatSuccess(statusMsg, [
          `✦ Item Terpasang : ${keep(res.item.name)}`,
          `✦ Biaya          : ${res.alreadyOwned ? 'Gratis (Sudah Dimiliki)' : `-${formatNumber(res.item.cost)} ${config.economy.currencyName}`}`,
          `✦ Sisa Saldo     : ${formatNumber(res.newBalance)} ${config.economy.currencyName}`,
          `◦ Lihat tampilan barumu di ${mono(`${prefix}profil`)}! ♡`,
        ]),
        footer: config.footer,
        ownerJid: senderJid,
        quoted: msg,
        buttons: [
          { id: `${prefix}profil`, text: '🪪 Lihat Kartu Profil' },
          { id: `${prefix}toko`, text: '🛍️ Kembali ke Toko' },
        ],
      });
    }

    // Tampilkan Katalog Toko Lengkap
    const profile = getUserProfile(senderJid, pushName);
    const wallet = getEconomy(senderJid);
    const ownedSet = getUserOwnedShopIds(senderJid);
    const allItems = Object.values(PROFILE_SHOP_ITEMS);

    const isEquipped = (item) => {
      if (item.type === 'bg') return profile.profileBg === item.value;
      if (item.type === 'frame') return profile.profileFrame === item.value;
      if (item.type === 'title') return profile.title === item.value;
      return false;
    };

    const formatGroup = (type, heading) => {
      const subset = allItems.filter((it) => it.type === type);
      const lines = [`❖ ${heading}`];
      for (const it of subset) {
        const eq = isEquipped(it);
        const own = ownedSet.has(it.id);
        const badge = eq
          ? '✨[Terpasang]'
          : own
          ? '✅[Dimiliki]'
          : `${formatNumber(it.cost)} Koin`;
        lines.push(`  ◦ ${mono(it.id)} — ${keep(it.name)} (${badge})`);
      }
      return lines;
    };

    const catalogLines = [
      `✦ Saldo Kamu : ${formatNumber(wallet.balance)} ${config.economy.currencyName}`,
      `✦ Cara Beli  : ${mono(`${prefix}toko beli <kode>`)}`,
      '',
      ...formatGroup('bg', 'Background Kartu Profil'),
      '',
      ...formatGroup('frame', 'Bingkai Kartu Profil'),
      '',
      ...formatGroup('title', 'Gelar Kustom Profil'),
    ];

    const buildRows = (type) =>
      allItems
        .filter((it) => it.type === type)
        .map((it) => ({
          title: it.name,
          description: ownedSet.has(it.id)
            ? 'Sudah dimiliki — Klik untuk pasang'
            : `Harga: ${formatNumber(it.cost)} ${config.economy.currencyName}`,
          command: `${prefix}toko beli ${it.id}`,
        }));

    await sendButtons(sock, chatJid, {
      title: '❖ Butik Kustomisasi Profil ❖',
      text: renderBox('ʙᴜᴛɪᴋ ᴋᴀʀᴛᴜ ᴘʀᴏꜰɪʟ ᴄɪᴘɪsᴍᴘ', catalogLines, {
        footer: config.footer,
      }),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        {
          type: 'list',
          title: '🛍️ Pilih & Pasang Item',
          sections: [
            { title: '🌸 Background Kartu', rows: buildRows('bg') },
            { title: '🖼️ Bingkai Kartu', rows: buildRows('frame') },
            { title: '👑 Gelar Kustom', rows: buildRows('title') },
          ],
        },
        { id: `${prefix}profil`, text: '🪪 Cek Profilku' },
      ],
    });
  },
};
