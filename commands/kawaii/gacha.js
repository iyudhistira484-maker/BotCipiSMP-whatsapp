const config = require('../../config');
const {
  GACHA_CHARACTERS,
  SHARD_EXCHANGE_COST,
  performGachaPull,
  redeemCharacterWithShards,
  getUserGachaSummary,
} = require('../../lib/kawaii');
const { getEconomy } = require('../../lib/economy');
const { renderGachaCard } = require('../../lib/card');
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
  name: 'gacha',
  alias: ['pull', 'summon', 'waifu'],
  category: 'kawaii',
  description: 'Putar Gacha Karakter/Waifu (N/R/SR/SSR), Multi-Pull 10x, & Tukar Shard',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, args, prefix, reply } = ctx;
    const sub = String(args[0] || '').toLowerCase().trim();
    const singleCost = Number(config.gacha.pullCost || 250);
    const multiCost = singleCost * 9;

    // 1. Info peluang & sistem pity (.gacha info / .gacha rates)
    if (sub === 'info' || sub === 'rate' || sub === 'rates') {
      const summary = getUserGachaSummary(senderJid);
      const wallet = getEconomy(senderJid);
      const ssrList = GACHA_CHARACTERS.filter((c) => c.rarity === 'SSR')
        .map((c) => `${keep(c.id)} (${keep(c.shortName)})`)
        .join(', ');

      return sendButtons(sock, chatJid, {
        title: '❖ Kuil Gacha Sakura ❖',
        text: renderBox(
          'ɪɴꜰᴏ ɢᴀᴄʜᴀ ᴡᴀɪꜰᴜ ᴄɪᴘɪsᴍᴘ',
          [
            `✦ 1x Pull   : ${formatNumber(singleCost)} ${config.economy.currencyName}`,
            `✦ 10x Pull  : ${formatNumber(multiCost)} ${config.economy.currencyName} (Hemat 10% + Jaminan SR+!)`,
            `✦ Pity SSR  : ${summary.pityCounter}/50 Pull (Jaminan SSR di pull ke-50!)`,
            `✦ Saldo     : ${formatNumber(wallet.balance)} ${config.economy.currencyName}`,
            `✦ Shards    : ${formatNumber(summary.shards)} Starlight Shards`,
            '',
            `◦ Peluang   : SSR ${config.gacha.rates.SSR}% | SR ${config.gacha.rates.SR}% | R ${config.gacha.rates.R}% | N ${config.gacha.rates.N}%`,
            `◦ Tukar SSR : ${mono(`${prefix}gacha tukar <id>`)} (${SHARD_EXCHANGE_COST.SSR} Shards)`,
            `◦ Daftar SSR: ${ssrList}`,
          ],
          { footer: config.footer }
        ),
        footer: config.footer,
        ownerJid: senderJid,
        quoted: msg,
        buttons: [
          { id: `${prefix}gacha 1`, text: `🌸 Gacha 1x (${singleCost})` },
          { id: `${prefix}gacha 10`, text: `✨ Multi 10x (${multiCost})` },
          { id: `${prefix}koleksi`, text: '📖 Koleksiku' },
        ],
      });
    }

    // 2. Tukar Starlight Shards menjadi karakter SR / SSR pilihan (.gacha tukar <id>)
    if (sub === 'tukar' || sub === 'redeem' || sub === 'shop') {
      const targetQuery = args.slice(1).join(' ').trim();
      if (!targetQuery) {
        const redeemable = GACHA_CHARACTERS.filter(
          (c) => SHARD_EXCHANGE_COST[c.rarity]
        ).map(
          (c) =>
            `◦ [${keep(c.rarity)}] ${keep(c.name)} — ID: ${mono(c.id)} (${SHARD_EXCHANGE_COST[c.rarity]} Shards)`
        );
        return reply(
          renderBox(
            'ᴛᴏᴋᴏ sᴛᴀʀʟɪɢʜᴛ sʜᴀʀᴅs',
            [
              '✦ Tukarkan kepingan duplikatmu menjadi karakter impian:',
              ...redeemable,
              '',
              `✦ Cara tukar: ${mono(`${prefix}gacha tukar ssr_sakura`)}`,
            ],
            { footer: config.footer }
          )
        );
      }

      const res = redeemCharacterWithShards(senderJid, targetQuery);
      if (!res.ok) {
        if (res.reason === 'insufficient_shards') {
          return reply(
            formatWarning('Starlight Shards Belum Cukup', [
              `✦ Karakter : [${keep(res.character.rarity)}] ${keep(res.character.name)}`,
              `✦ Butuh    : ${formatNumber(res.cost)} Shards`,
              `✦ Milikmu  : ${formatNumber(res.have)} Shards`,
              `◦ Dapatkan Shards otomatis saat menarik karakter duplikat di ${mono(`${prefix}gacha`)}!`,
            ])
          );
        }
        return reply(
          formatWarning('Karakter Tidak Ditemukan', [
            `✦ Hanya karakter SR & SSR yang dapat ditukar dengan Shards.`,
            `✦ Cek daftar kode di ${mono(`${prefix}gacha tukar`)} ya!`,
          ])
        );
      }

      return reply(
        formatSuccess('Penukaran Shards Berhasil! ✨', [
          `✦ Karakter  : [${keep(res.character.rarity)}] ${keep(res.character.name)}`,
          `✦ Biaya     : -${formatNumber(res.shardCost)} Starlight Shards`,
          `✦ Sisa Shard: ${formatNumber(res.remainingShards)} Starlight Shards`,
          `◦ Cek koleksimu di ${mono(`${prefix}koleksi`)} ♡`,
        ])
      );
    }

    // 3. Eksekusi Gacha 1x atau 10x Multi-Pull
    const pullCount = sub === '10' || sub === '10x' || sub === 'multi' ? 10 : 1;
    const pullRes = performGachaPull(senderJid, pullCount);

    if (!pullRes.ok) {
      return reply(
        formatWarning('Sakura Coin Belum Cukup 🌸', [
          `✦ Biaya ${pullCount}x Gacha : ${formatNumber(pullRes.cost)} ${config.economy.currencyName}`,
          `✦ Saldo Kamu      : ${formatNumber(pullRes.balance)} ${config.economy.currencyName}`,
          `◦ Yuk klaim ${mono(`${prefix}daily`)}, ${mono(`${prefix}kerja`)}, atau kerjakan ${mono(`${prefix}quest`)} dulu~`,
        ])
      );
    }

    const feat = pullRes.featured;
    const char = feat.character;

    const lines = [];
    if (pullCount === 1) {
      lines.push(
        `✦ Hasil    : [${keep(char.rarity)}] ${keep(char.name)} ${feat.isNew ? '(BARU! ✨)' : `(Duplikat +${feat.shardsGained} Shards)`}`,
        `✦ Gelar    : ${keep(char.title)} (${keep(char.element)})`,
        `✦ Kutipan  : "${char.quote}"`
      );
    } else {
      lines.push(`✦ Ringkasan 10x Multi-Pull:`);
      pullRes.results.forEach((item, i) => {
        const tag = item.isNew ? '✨BARU' : `+${item.shardsGained}✦`;
        lines.push(
          `◦ ${i + 1}. [${keep(item.character.rarity)}] ${keep(item.character.shortName)} (${tag})`
        );
      });
    }

    lines.push(
      '',
      `✦ Pity SSR : ${pullRes.pityCounter}/50 | Shards: ${formatNumber(pullRes.totalShards)}`,
      `◦ Sisa Saldo: ${formatNumber(pullRes.newBalance)} ${config.economy.currencyName}`
    );

    const caption = renderBox(
      pullCount === 10 ? 'ʜᴀsɪʟ 10x ᴍᴜʟᴛɪ-ᴘᴜʟʟ ɢᴀᴄʜᴀ' : 'ʜᴀsɪʟ ɢᴀᴄʜᴀ ᴋᴀʀᴀᴋᴛᴇʀ',
      lines,
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderGachaCard({
        character: char,
        isNew: feat.isNew,
        shardsGained: pullCount === 10 ? pullRes.totalShardsGained : feat.shardsGained,
        pullCount,
        totalOwnedCount: feat.totalOwnedCount,
        pullSummary: pullRes.results.map((r) => ({
          rarity: r.character.rarity,
          shortName: r.character.shortName,
        })),
        userName: pushName || 'Petualang',
      });
    } catch (err) {
      logger.error('CMD:GACHA', 'Gagal merender kartu gacha, fallback ke teks', err);
    }

    await sendButtons(sock, chatJid, {
      title: `❖ [${keep(char.rarity)}] ${keep(char.name)} ❖`,
      text: caption,
      footer: config.footer,
      image: cardBuffer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}gacha 1`, text: `🌸 Gacha 1x (${singleCost})` },
        { id: `${prefix}gacha 10`, text: `✨ Multi 10x (${multiCost})` },
        { id: `${prefix}koleksi`, text: '📖 Koleksiku' },
      ],
    });
  },
};
