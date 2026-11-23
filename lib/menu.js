const config = require('../config');
const { formatMentionTag } = require('./database');
const { smallcaps, boldSans, mono, stripKeepMarkers, DIVIDER } = require('./smallcaps');
const { getWibGreeting, formatUptime, formatNumber } = require('./logger');

/**
 * Definisi kategori standar bot (Fase 1 s/d Fase 7) — bersih tanpa banjir emoji
 */
const CATEGORY_META = Object.freeze({
  info: { key: 'info', title: 'Info & Utama', emoji: '•', order: 1 },
  group: { key: 'group', title: 'Manajemen Grup', emoji: '•', order: 2 },
  economy: { key: 'economy', title: 'Ekonomi & Level', emoji: '•', order: 3 },
  tools: { key: 'tools', title: 'Tools & Media', emoji: '•', order: 4 },
  server: { key: 'server', title: 'Minecraft & AI', emoji: '•', order: 5 },
  community: { key: 'community', title: 'Komunitas & Quest', emoji: '•', order: 6 },
  kawaii: { key: 'kawaii', title: 'Gacha & Pet Kawaii', emoji: '•', order: 7 },
  fun: { key: 'fun', title: 'Hiburan & Game', emoji: '•', order: 8 },
  owner: { key: 'owner', title: 'Khusus Owner', emoji: '•', order: 9 },
});

/**
 * Kelompokkan seluruh command terdaftar per kategori (menyembunyikan ownerOnly bila bukan owner)
 * @param {Map<string, object>} commandsMap
 * @param {{ includeOwner?: boolean }} [opts]
 */
function groupCommandsByCategory(commandsMap, opts = {}) {
  const buckets = new Map();
  const seen = new Set();

  for (const cmd of commandsMap.values()) {
    if (!cmd || !cmd.name || seen.has(cmd.name)) continue;
    seen.add(cmd.name);

    const catKey = String(cmd.category || 'info').toLowerCase();
    if (catKey === 'owner' && !opts.includeOwner) continue;

    if (!buckets.has(catKey)) {
      const meta = CATEGORY_META[catKey] || {
        key: catKey,
        title: catKey.charAt(0).toUpperCase() + catKey.slice(1),
        emoji: '•',
        order: 99,
      };
      buckets.set(catKey, {
        ...meta,
        commands: [],
      });
    }
    buckets.get(catKey).commands.push(cmd);
  }

  const list = Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      commands: bucket.commands.sort((a, b) => a.name.localeCompare(b.name)),
      count: bucket.commands.length,
    }))
    .sort((a, b) => a.order - b.order);

  return list;
}

/**
 * Bangun teks menu minimalis, rapi, hanya 1 aksen warna di atas, & nyaman dibaca di layar HP
 */
function buildMenuText({
  senderJid,
  senderNumber,
  profile,
  uptimeMs,
  totalUsers,
  categories,
  selectedCategory = null,
  fullTextMode = false,
}) {
  const greet = getWibGreeting();
  const mentionTag = senderJid
    ? formatMentionTag(senderJid, profile.name)
    : senderNumber
    ? `@${senderNumber}`
    : stripKeepMarkers(profile.name);
  const p = config.prefix;
  const statusBadge = profile.premium?.isOwner
    ? 'Owner'
    : profile.premium?.isPremium
    ? 'Sakura VIP'
    : 'Member';

  const lines = [
    `🌸 *${boldSans('MENU UTAMA CIPISMP')}*`,
    DIVIDER,
    `${greet.greeting}, ${mentionTag}!`,
    `• *${smallcaps('nama')}* : ${stripKeepMarkers(profile.name)} (${statusBadge})`,
    `• *${smallcaps('level')}* : Lv.${profile.level} (${formatNumber(profile.xp)}/${formatNumber(profile.xpNeeded)} XP)`,
    `• *${smallcaps('saldo')}* : ${formatNumber(profile.balance)} ${config.economy.currencyName}`,
    `• *${smallcaps('uptime')}* : ${formatUptime(uptimeMs)}`,
    `• *${smallcaps('member')}* : ${formatNumber(totalUsers)} petualang`,
    DIVIDER,
  ];

  if (selectedCategory) {
    lines.push(`*${boldSans(selectedCategory.title.toUpperCase())}* (${selectedCategory.count})`);
    lines.push('');
    for (const cmd of selectedCategory.commands) {
      const flags = [];
      if (cmd.ownerOnly) flags.push('Owner');
      if (cmd.premiumOnly) flags.push('VIP');
      if (cmd.adminOnly) flags.push('Admin');
      if (cmd.groupOnly) flags.push('Grup');
      const badge = flags.length > 0 ? ` _(${flags.join(', ')})_` : '';
      lines.push(
        `• ${mono(`${p}${cmd.name}`)} — ${cmd.description || 'Command bot'}${badge}`
      );
    }
  } else if (fullTextMode) {
    for (let idx = 0; idx < categories.length; idx += 1) {
      const cat = categories[idx];
      if (idx > 0) lines.push('');
      lines.push(`*${boldSans(cat.title.toUpperCase())}* (${cat.count})`);
      for (const cmd of cat.commands) {
        lines.push(`• ${mono(`${p}${cmd.name}`)} — ${cmd.description || ''}`);
      }
    }
  } else {
    lines.push(`*${boldSans('PILIH KATEGORI')}*`);
    for (const cat of categories) {
      lines.push(
        `• ${mono(`${p}menu ${cat.key}`)} — ${cat.title} _(${cat.count})_`
      );
    }
    lines.push('');
    lines.push(`Ketik ${mono(`${p}menu all`)} untuk daftar lengkap seluruh command.`);
  }

  return lines.join('\n');
}

/**
 * Bangun daftar tombol interaktif untuk .menu (bersih & simpel)
 */
function buildMenuButtons(categories = []) {
  const p = config.prefix;
  const rows = [
    {
      header: 'Semua Command',
      title: 'Tampilkan Semua Menu',
      description: 'Lihat seluruh daftar command lengkap',
      command: `${p}menu all`,
    },
    ...categories.map((cat) => ({
      header: cat.title,
      title: `Menu ${cat.title}`,
      description: `${cat.count} command tersedia di kategori ini`,
      command: `${p}menu ${cat.key}`,
    })),
  ];

  const buttons = [
    {
      type: 'list',
      title: 'Pilih Kategori Menu',
      sections: [
        {
          title: 'Kategori Command CipiSMP',
          rows,
        },
      ],
    },
    {
      command: `${p}profil`,
      text: 'Profilku',
    },
    {
      command: `${p}ping`,
      text: 'Cek Ping',
    },
  ];

  if (config.links.discord) {
    buttons.push({
      type: 'url',
      text: 'Discord CipiSMP',
      url: config.links.discord,
    });
  }

  return buttons;
}

module.exports = {
  CATEGORY_META,
  groupCommandsByCategory,
  buildMenuText,
  buildMenuButtons,
};
