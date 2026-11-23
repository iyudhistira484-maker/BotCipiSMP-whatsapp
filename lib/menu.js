const config = require('../config');
const { smallcaps, boldSans, mono, keep } = require('./smallcaps');
const { getWibGreeting, formatUptime, formatNumber } = require('./logger');

/**
 * Definisi kategori standar bot untuk seluruh fase (Fase 1 s/d Fase 7)
 */
const CATEGORY_META = Object.freeze({
  info: { key: 'info', title: 'Info & Utama', emoji: '✿', order: 1 },
  group: { key: 'group', title: 'Manajemen Grup', emoji: '❖', order: 2 },
  economy: { key: 'economy', title: 'Ekonomi & Level', emoji: '♡', order: 3 },
  tools: { key: 'tools', title: 'Tools & Media', emoji: '✦', order: 4 },
  server: { key: 'server', title: 'Minecraft & AI', emoji: '❖', order: 5 },
  community: { key: 'community', title: 'Komunitas & Quest', emoji: '✿', order: 6 },
  kawaii: { key: 'kawaii', title: 'Gacha & Pet Kawaii', emoji: '♡', order: 7 },
  fun: { key: 'fun', title: 'Hiburan & Game', emoji: '✦', order: 8 },
  owner: { key: 'owner', title: 'Khusus Owner', emoji: '❖', order: 9 },
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
        emoji: '✿',
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
 * Bangun teks caption ringkas & manis pendamping Kartu Menu (atau versi lengkap saat fallback teks)
 */
function buildMenuText({
  senderNumber,
  profile,
  uptimeMs,
  totalUsers,
  categories,
  selectedCategory = null,
  fullTextMode = false,
}) {
  const greet = getWibGreeting();
  const mentionTag = senderNumber ? `@${senderNumber}` : keep(profile.name);
  const p = config.prefix;

  const lines = [
    `╭─❖ ${boldSans('MENU UTAMA')} ❖`,
    `│ ${greet.emoji} ${smallcaps(`${greet.greeting},`)} ${mentionTag} ♡`,
    `│ ✦ ${smallcaps('nama')}   : ${keep(profile.name)}`,
    `│ ✦ ${smallcaps('level')}  : Lv.${profile.level} (${formatNumber(profile.xp)}/${formatNumber(profile.xpNeeded)} XP)`,
    `│ ✦ ${smallcaps('saldo')}  : ${formatNumber(profile.balance)} ${smallcaps(config.economy.currencyName)}`,
    `│ ✦ ${smallcaps('uptime')} : ${keep(formatUptime(uptimeMs))}`,
    `│ ✦ ${smallcaps('user')}   : ${formatNumber(totalUsers)} ${smallcaps('petualang')}`,
    '╰────────────',
  ];

  if (selectedCategory) {
    lines.push('');
    lines.push(`╭─❖ ${smallcaps(`${selectedCategory.emoji} kategori ${selectedCategory.title}`)} ❖`);
    for (const cmd of selectedCategory.commands) {
      const flags = [];
      if (cmd.ownerOnly) flags.push('owner');
      if (cmd.premiumOnly) flags.push('vip');
      if (cmd.adminOnly) flags.push('admin');
      if (cmd.groupOnly) flags.push('grup');
      const badge = flags.length > 0 ? ` [${smallcaps(flags.join('/'))}]` : '';
      lines.push(
        `│ ◦ ${mono(`${p}${cmd.name}`)} — ${smallcaps(cmd.description || 'command bot')}${badge}`
      );
    }
    lines.push('╰────────────');
  } else if (fullTextMode) {
    for (const cat of categories) {
      lines.push('');
      lines.push(`╭─❖ ${smallcaps(`${cat.emoji} ${cat.title}`)} (${cat.count}) ❖`);
      for (const cmd of cat.commands) {
        lines.push(`│ ◦ ${mono(`${p}${cmd.name}`)} — ${smallcaps(cmd.description || '')}`);
      }
      lines.push('╰────────────');
    }
  } else {
    lines.push('');
    lines.push(`╭─❖ ${smallcaps('✿ pilih kategori menu')} ❖`);
    for (const cat of categories) {
      lines.push(
        `│ ◦ ${mono(`${p}menu ${cat.key}`)} — ${smallcaps(cat.title)} (${cat.count})`
      );
    }
    lines.push(`│ ✦ ${smallcaps('ketik')} ${mono(`${p}menu all`)} ${smallcaps('untuk daftar lengkap!')}`);
    lines.push('╰────────────');
  }

  return lines.join('\n');
}

/**
 * Bangun daftar tombol interaktif untuk .menu (list kategori + tombol cepat + link komunitas)
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
      header: `${cat.emoji} ${cat.title}`,
      title: `Menu ${cat.title}`,
      description: `${cat.count} command tersedia di kategori ini`,
      command: `${p}menu ${cat.key}`,
    })),
  ];

  const buttons = [
    {
      type: 'list',
      title: '✿ Pilih Kategori Menu',
      sections: [
        {
          title: 'Kategori Command CipiSMP',
          rows,
        },
      ],
    },
    {
      command: `${p}profil`,
      text: '♡ Profilku',
    },
    {
      command: `${p}ping`,
      text: '✦ Cek Ping',
    },
  ];

  if (config.links.discord) {
    buttons.push({
      type: 'url',
      text: '❖ Discord CipiSMP',
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
