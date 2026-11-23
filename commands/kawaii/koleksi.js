const config = require('../../config');
const { ensureUser, normalizeUserJid } = require('../../lib/database');
const { GACHA_CHARACTERS, getUserGachaSummary } = require('../../lib/kawaii');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep, mono } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'koleksi',
  alias: ['collection', 'harem', 'mywaifu'],
  category: 'kawaii',
  description: 'Lihat album koleksi karakter Gacha, kelengkapan SSR/SR/R/N, & Starlight Shards',
  cooldown: 4,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, mentionedJids, prefix } = ctx;

    const targetJid =
      mentionedJids && mentionedJids.length > 0
        ? normalizeUserJid(mentionedJids[0])
        : senderJid;
    const isSelf = targetJid === senderJid;
    const user = ensureUser(targetJid, isSelf ? pushName : '');
    const summary = getUserGachaSummary(targetJid);

    const pct = Math.round((summary.uniqueOwned / summary.totalCatalog) * 100);
    const lines = [
      `✦ Kolektor  : ${keep(user?.name || 'Petualang')}`,
      `✦ Album     : ${summary.uniqueOwned}/${summary.totalCatalog} Karakter (${pct}%)`,
      `✦ Total Pull: ${formatNumber(summary.totalPulls)}x`,
      `✦ Pity SSR  : ${summary.pityCounter}/50 Pull`,
      `✦ Shards    : ${formatNumber(summary.shards)} Starlight Shards`,
      '',
    ];

    if (summary.ownedRows.length === 0) {
      lines.push(
        '◦ Album koleksimu masih kosong nih~',
        `◦ Yuk putar gacha pertamamu dengan ${mono(`${prefix}gacha`)}!`
      );
    } else {
      for (const tier of ['SSR', 'SR', 'R', 'N']) {
        const tierRows = summary.ownedRows.filter((r) => r.rarity === tier);
        const totalInTier = GACHA_CHARACTERS.filter((c) => c.rarity === tier).length;
        if (tierRows.length === 0) {
          lines.push(`❖ [${keep(tier)}] (0/${totalInTier}) : Belum dimiliki`);
        } else {
          lines.push(`❖ [${keep(tier)}] (${tierRows.length}/${totalInTier}) :`);
          for (const row of tierRows) {
            lines.push(`  ◦ ${keep(row.character_name)} (x${row.count})`);
          }
        }
      }
      lines.push(
        '',
        `◦ Tukar Shards ke SR/SSR pilihan: ${mono(`${prefix}gacha tukar`)}`
      );
    }

    await sendButtons(sock, chatJid, {
      title: `❖ Album Koleksi ${keep(user?.name || 'Petualang')} ❖`,
      text: renderBox('ᴀʟʙᴜᴍ ᴋᴏʟᴇᴋsɪ ᴡᴀɪꜰᴜ', lines, { footer: config.footer }),
      footer: config.footer,
      ownerJid: senderJid,
      mentions: [targetJid],
      quoted: msg,
      buttons: [
        { id: `${prefix}gacha 1`, text: '🌸 Gacha 1x' },
        { id: `${prefix}gacha 10`, text: '✨ Multi 10x' },
        { id: `${prefix}gacha info`, text: '📊 Info & Pity' },
      ],
    });
  },
};
