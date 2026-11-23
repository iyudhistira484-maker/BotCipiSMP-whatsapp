const crypto = require('crypto');
const cron = require('node-cron');
const config = require('../config');
const {
  getDb,
  ensureUser,
  normalizeUserJid,
  extractPhoneFromJid,
  getSetting,
  setSetting,
  addXp,
  addAuditLog,
} = require('./database');
const { getEconomy, addBalance, deductBalance } = require('./economy');
const {
  renderBox,
  formatSuccess,
  keep,
  mono,
} = require('./smallcaps');
const { getWibDateKey, getWibParts, formatNumber, logger } = require('./logger');

let activeWaSock = null;
let birthdayCronTask = null;

// Sesi game aktif per chatJid (Kuis & Tebak Gambar)
const activeChatGames = new Map();

// =====================================================================
// 1. KATALOG & MESIN GACHA KARAKTER / WAIFU (N / R / SR / SSR)
// =====================================================================

const GACHA_CHARACTERS = Object.freeze([
  // SSR (3%)
  {
    id: 'ssr_sakura',
    name: 'Putri Sakura Hime',
    shortName: 'Sakura Hime',
    rarity: 'SSR',
    element: 'Bunga Abadi',
    title: 'Ratu Kelopak Musim Semi',
    quote: 'Selama kelopak sakura masih berterbangan, aku akan selalu menjaga petualanganmu ♡',
    imageFile: 'gacha/ssr-sakura.png',
  },
  {
    id: 'ssr_celestia',
    name: 'Luna Celestia',
    shortName: 'Celestia',
    rarity: 'SSR',
    element: 'Bintang Malam',
    title: 'Penyihir Rasi Bintang',
    quote: 'Lihatlah ke langit malam CipiSMP, setiap bintang menyimpan doa keberuntungan untukmu ✦',
    imageFile: 'gacha/ssr-celestia.png',
  },
  {
    id: 'ssr_aurora',
    name: 'Kaguya Aurora',
    shortName: 'Aurora',
    rarity: 'SSR',
    element: 'Cahaya Kristal',
    title: 'Penjaga Kastil Awan',
    quote: 'Kilau berlian terbaik bukanlah di tambang terdalam, melainkan senyummu hari ini ♡',
    imageFile: 'mascot.png',
  },

  // SR (15%)
  {
    id: 'sr_koharu',
    name: 'Koharu Kitsune',
    shortName: 'Koharu',
    rarity: 'SR',
    element: 'Api Suci',
    title: 'Gadis Rubah Kuil Senja',
    quote: 'Kon-kon! Ekor halusku membawa hoki besar buat hasil tambangmu hari ini~',
    imageFile: 'gacha/sr-kitsune.png',
  },
  {
    id: 'sr_ayame',
    name: 'Ayame Shirayuki',
    shortName: 'Ayame',
    rarity: 'SR',
    element: 'Salju Murni',
    title: 'Ksatria Pedang Es',
    quote: 'Dinginnya puncak gunung takkan menghentikan langkah kita berdua!',
    imageFile: 'gacha/ssr-celestia.png',
  },
  {
    id: 'sr_himari',
    name: 'Himari Surya',
    shortName: 'Himari',
    rarity: 'SR',
    element: 'Mentari Pagi',
    title: 'Alkemis Ramuan Emas',
    quote: 'Ramuan Golden Apple racikanku siap memulihkan semangatmu kapan saja ✿',
    imageFile: 'gacha/ssr-sakura.png',
  },
  {
    id: 'sr_tsukimi',
    name: 'Tsukimi Usagi',
    shortName: 'Tsukimi',
    rarity: 'SR',
    element: 'Bulan Sabit',
    title: 'Pemanah Cahaya Rembulan',
    quote: 'Lompat setinggi langit, rezeki manis pasti menghampiri!',
    imageFile: 'gacha/sr-kitsune.png',
  },

  // R (37%)
  {
    id: 'r_clover',
    name: 'Miku Clover',
    shortName: 'Clover',
    rarity: 'R',
    element: 'Angin Segar',
    title: 'Pemandu Petualang Muda',
    quote: 'Daun semanggi berdaun empat ini kutemukan khusus untukmu!',
    imageFile: 'gacha/r-clover.png',
  },
  {
    id: 'r_shiori',
    name: 'Shiori Pustaka',
    shortName: 'Shiori',
    rarity: 'R',
    element: 'Air Tenang',
    title: 'Penjaga Buku Enchantment',
    quote: 'Mending atau Unbreaking III? Ayo kita cari buku terbaik hari ini~',
    imageFile: 'gacha/r-clover.png',
  },
  {
    id: 'r_nanami',
    name: 'Nanami Coral',
    shortName: 'Nanami',
    rarity: 'R',
    element: 'Samudra Biru',
    title: 'Penjelajah Kuil Laut',
    quote: 'Deburan ombak selalu membawa cerita seru dari pulau seberang!',
    imageFile: 'gacha/r-clover.png',
  },
  {
    id: 'r_kotori',
    name: 'Kotori Melodi',
    shortName: 'Kotori',
    rarity: 'R',
    element: 'Nada Ceria',
    title: 'Penyanyi Note Block',
    quote: 'Lagu ceria di lobi akan menemani waktu istirahatmu ♡',
    imageFile: 'gacha/n-berry.png',
  },

  // N (45%)
  {
    id: 'n_ichigo',
    name: 'Ichigo Berry',
    shortName: 'Ichigo',
    rarity: 'N',
    element: 'Stroberi Manis',
    title: 'Pembuat Kue Desa',
    quote: 'Kue stroberi hangat baru keluar dari panggangan, cicipi yuk!',
    imageFile: 'gacha/n-berry.png',
  },
  {
    id: 'n_mochi',
    name: 'Momo Mochi',
    shortName: 'Momo',
    rarity: 'N',
    element: 'Mochi Lembut',
    title: 'Pelayan Kedai Teh Sakura',
    quote: 'Secangkir teh hangat dan mochi manis membuat lelah langsung hilang~',
    imageFile: 'gacha/n-berry.png',
  },
  {
    id: 'n_sumire',
    name: 'Sumire Daun',
    shortName: 'Sumire',
    rarity: 'N',
    element: 'Hutan Rindang',
    title: 'Pekebun Bunga Berry',
    quote: 'Merawat kebun kecil bersama teman-teman itu menyenangkan sekali!',
    imageFile: 'gacha/r-clover.png',
  },
  {
    id: 'n_aoi',
    name: 'Aoi Embun',
    shortName: 'Aoi',
    rarity: 'N',
    element: 'Embun Pagi',
    title: 'Pengantar Surat Komunitas',
    quote: 'Selamat pagi! Ada kabar gembira untuk petualanganmu hari ini!',
    imageFile: 'gacha/r-clover.png',
  },
  {
    id: 'n_yuzu',
    name: 'Yuzu Madu',
    shortName: 'Yuzu',
    rarity: 'N',
    element: 'Jeruk Hangat',
    title: 'Peternak Lebah Ceria',
    quote: 'Madu manis dari sarang lebah hutan siap menambah tenagamu!',
    imageFile: 'gacha/n-berry.png',
  },
]);

const RARITY_RANK = { N: 1, R: 2, SR: 3, SSR: 4 };
const SHARD_EXCHANGE_COST = { SSR: 400, SR: 150 };

function rollOneRarity({ forceSrPlus = false, forceSsr = false } = {}) {
  if (forceSsr) return 'SSR';
  const rates = config.gacha.rates || { SSR: 3, SR: 15, R: 37, N: 45 };
  if (forceSrPlus) {
    const roll = crypto.randomInt(1, 19); // 3 dari 18 peluang SSR (~16.6%), sisanya SR
    return roll <= rates.SSR ? 'SSR' : 'SR';
  }
  const roll = crypto.randomInt(1, 101);
  if (roll <= rates.SSR) return 'SSR';
  if (roll <= rates.SSR + rates.SR) return 'SR';
  if (roll <= rates.SSR + rates.SR + rates.R) return 'R';
  return 'N';
}

function pickCharacterByRarity(rarity) {
  const pool = GACHA_CHARACTERS.filter((c) => c.rarity === rarity);
  return pool[crypto.randomInt(0, pool.length)];
}

function getUserPity(jid) {
  return Number(getSetting(`gacha_pity:${jid}`, '0') || 0);
}

function setUserPity(jid, val) {
  setSetting(`gacha_pity:${jid}`, String(Math.max(0, Math.floor(val))));
}

/**
 * Lakukan Gacha 1x atau 10x Multi-Pull (diskon 10% + jaminan minimal 1 SR+ & Pity SSR 50x)
 */
function performGachaPull(rawJid, pullCount = 1) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);

  const count = pullCount === 10 ? 10 : 1;
  const singleCost = Number(config.gacha.pullCost || 250);
  const totalCost = count === 10 ? singleCost * 9 : singleCost; // Diskon 1x gratis untuk 10-pull!

  const wallet = getEconomy(jid);
  if (wallet.balance < totalCost) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      cost: totalCost,
      balance: wallet.balance,
    };
  }

  const deduct = deductBalance(jid, totalCost);
  if (!deduct.ok) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      cost: totalCost,
      balance: wallet.balance,
    };
  }

  const db = getDb();
  const shardTable = config.gacha.duplicateShards || {
    N: 5,
    R: 15,
    SR: 45,
    SSR: 120,
  };

  let pity = getUserPity(jid);
  const results = [];
  let totalShardsGained = 0;

  db.transaction(() => {
    let gotSrOrHigher = false;
    const now = Date.now();

    for (let i = 0; i < count; i += 1) {
      pity += 1;
      const forceSsr = pity >= 50;
      const forceSrPlus = count === 10 && i === 9 && !gotSrOrHigher && !forceSsr;

      const rarity = rollOneRarity({ forceSrPlus, forceSsr });
      if (rarity === 'SSR') pity = 0;
      if (rarity === 'SR' || rarity === 'SSR') gotSrOrHigher = true;

      const char = pickCharacterByRarity(rarity);
      const existing = db.get(
        'SELECT * FROM gacha WHERE jid = ? AND character_id = ?',
        [jid, char.id]
      );

      let isNew = false;
      let shards = 0;
      let nextCount = 1;

      if (!existing) {
        isNew = true;
        db.run(
          `INSERT INTO gacha (
             jid, character_id, character_name, rarity, count, image_file, obtained_at, last_pulled_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [jid, char.id, char.name, char.rarity, char.imageFile, now, now]
        );
      } else {
        nextCount = Number(existing.count || 1) + 1;
        shards = Number(shardTable[char.rarity] || 5);
        totalShardsGained += shards;
        db.run(
          'UPDATE gacha SET count = ?, last_pulled_at = ? WHERE id = ?',
          [nextCount, now, existing.id]
        );
      }

      results.push({
        character: char,
        isNew,
        shardsGained: shards,
        totalOwnedCount: nextCount,
      });
    }

    if (totalShardsGained > 0) {
      db.run(
        'UPDATE economy SET gacha_shards = gacha_shards + ?, updated_at = ? WHERE jid = ?',
        [totalShardsGained, now, jid]
      );
    }
  });

  setUserPity(jid, pity);

  // Pilih hasil terbaik (rarity tertinggi, utamakan karakter baru) sebagai kartu utama
  const featured = [...results].sort((a, b) => {
    const rDiff = RARITY_RANK[b.character.rarity] - RARITY_RANK[a.character.rarity];
    if (rDiff !== 0) return rDiff;
    return Number(b.isNew) - Number(a.isNew);
  })[0];

  const afterEco = getEconomy(jid);

  return {
    ok: true,
    count,
    cost: totalCost,
    newBalance: afterEco.balance,
    totalShards: Number(afterEco.gacha_shards || 0),
    totalShardsGained,
    pityCounter: pity,
    featured,
    results,
  };
}

/**
 * Tukar Starlight Shards dari duplikat untuk klaim langsung karakter SR / SSR pilihan
 */
function redeemCharacterWithShards(rawJid, charQuery = '') {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);
  const q = String(charQuery || '').toLowerCase().trim();
  const char = GACHA_CHARACTERS.find(
    (c) =>
      c.id.toLowerCase() === q ||
      c.name.toLowerCase().includes(q) ||
      c.shortName.toLowerCase() === q
  );

  if (!char || !SHARD_EXCHANGE_COST[char.rarity]) {
    return { ok: false, reason: 'not_redeemable' };
  }

  const shardCost = SHARD_EXCHANGE_COST[char.rarity];
  const db = getDb();

  return db.transaction(() => {
    const eco = db.get('SELECT gacha_shards FROM economy WHERE jid = ?', [jid]);
    const have = Number(eco?.gacha_shards || 0);
    if (have < shardCost) {
      return {
        ok: false,
        reason: 'insufficient_shards',
        have,
        cost: shardCost,
        character: char,
      };
    }

    const now = Date.now();
    db.run(
      'UPDATE economy SET gacha_shards = gacha_shards - ?, updated_at = ? WHERE jid = ?',
      [shardCost, now, jid]
    );

    const existing = db.get(
      'SELECT * FROM gacha WHERE jid = ? AND character_id = ?',
      [jid, char.id]
    );
    let ownedCount = 1;
    if (!existing) {
      db.run(
        `INSERT INTO gacha (
           jid, character_id, character_name, rarity, count, image_file, obtained_at, last_pulled_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [jid, char.id, char.name, char.rarity, char.imageFile, now, now]
      );
    } else {
      ownedCount = Number(existing.count || 1) + 1;
      db.run('UPDATE gacha SET count = ?, last_pulled_at = ? WHERE id = ?', [
        ownedCount,
        now,
        existing.id,
      ]);
    }

    return {
      ok: true,
      character: char,
      shardCost,
      remainingShards: have - shardCost,
      ownedCount,
    };
  });
}

function getUserGachaSummary(rawJid) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);
  const db = getDb();
  const rows = db.all(
    'SELECT * FROM gacha WHERE jid = ? ORDER BY last_pulled_at DESC',
    [jid]
  );
  const eco = getEconomy(jid);
  const sorted = rows.sort(
    (a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0)
  );

  return {
    ownedRows: sorted,
    uniqueOwned: rows.length,
    totalCatalog: GACHA_CHARACTERS.length,
    totalPulls: rows.reduce((s, r) => s + Number(r.count || 0), 0),
    shards: Number(eco.gacha_shards || 0),
    pityCounter: getUserPity(jid),
  };
}

// =====================================================================
// 2. SISTEM PET VIRTUAL KAWAII (Adopsi, Makan, Main, Istirahat, Level)
// =====================================================================

const PET_SPECIES = Object.freeze({
  neko: {
    type: 'neko',
    label: 'Kucing Sakura',
    emoji: '🐱🌸',
    imageFile: 'gacha/sr-kitsune.png',
    Catchphrase: 'Nyaa~ elus kepalaku dan beri aku kue ikan manis ya!',
  },
  kitsune: {
    type: 'kitsune',
    label: 'Rubah Bintang',
    emoji: '🦊✨',
    imageFile: 'gacha/sr-kitsune.png',
    Catchphrase: 'Kon-kon! Ekor berkilauku siap menemani petualanganmu!',
  },
  usagi: {
    type: 'usagi',
    label: 'Kelinci Mochi',
    emoji: '🐰🍡',
    imageFile: 'gacha/n-berry.png',
    Catchphrase: 'Pyon! Aku suka melompat sambil makan dango stroberi!',
  },
  slime: {
    type: 'slime',
    label: 'Slime Pelangi',
    emoji: '💧🌈',
    imageFile: 'gacha/r-clover.png',
    Catchphrase: 'Puru-puru~ tubuh kenyalku selalu sejuk dan ceria!',
  },
  dragon: {
    type: 'dragon',
    label: 'Naga Kecil Kristal',
    emoji: '🐲💎',
    imageFile: 'gacha/ssr-celestia.png',
    Catchphrase: 'Rawr imut! Sayap kristalku berkilau menjaga tuanku!',
  },
});

function petXpNeeded(level) {
  return Math.max(80, Number(level || 1) * 85);
}

function getSyncedPet(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const db = getDb();
  const row = db.get('SELECT * FROM pets WHERE jid = ?', [jid]);
  if (!row) return null;

  const now = Date.now();
  const refTime = Math.max(
    Number(row.last_fed || 0),
    Number(row.last_played || 0),
    Number(row.adopted_at || now)
  );
  const elapsedHours = Math.max(0, (now - refTime) / (3600 * 1000));

  // Penurunan lembut maks saat ditinggal lama, tidak pernah mati (minimal 10%)
  if (elapsedHours >= 1) {
    const hungerDrop = Math.min(45, Math.floor(elapsedHours * 3));
    const happyDrop = Math.min(35, Math.floor(elapsedHours * 2));
    const energyGain = Math.min(40, Math.floor(elapsedHours * 5));

    row.hunger = Math.max(10, Number(row.hunger) - hungerDrop);
    row.happiness = Math.max(15, Number(row.happiness) - happyDrop);
    row.energy = Math.min(100, Number(row.energy) + energyGain);
  }

  return {
    ...row,
    speciesMeta: PET_SPECIES[row.pet_type] || PET_SPECIES.neko,
    xpNeeded: petXpNeeded(row.level),
  };
}

function adoptPet(rawJid, speciesKey = 'neko', customName = '') {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);
  const db = getDb();
  const existing = db.get('SELECT * FROM pets WHERE jid = ?', [jid]);
  if (existing) {
    return { ok: false, reason: 'already_have_pet', existing };
  }

  const key = String(speciesKey || 'neko').toLowerCase().trim();
  const species = PET_SPECIES[key];
  if (!species) {
    return { ok: false, reason: 'invalid_species' };
  }

  const cleanName =
    String(customName || '')
      .replace(/[^\w\s.'-]/g, '')
      .trim()
      .slice(0, 24) || species.label.split(' ')[1] || 'Mochi';

  const now = Date.now();
  db.run(
    `INSERT INTO pets (
       jid, pet_type, pet_name, level, xp, hunger, happiness, energy, last_fed, last_played, adopted_at
     ) VALUES (?, ?, ?, 1, 0, 85, 90, 100, ?, ?, ?)`,
    [jid, key, cleanName, now, now, now]
  );

  return {
    ok: true,
    pet: getSyncedPet(jid),
  };
}

function addPetXpInternal(petRow, gainedXp) {
  let lvl = Number(petRow.level || 1);
  let xp = Number(petRow.xp || 0) + gainedXp;
  let leveledUp = false;
  while (xp >= petXpNeeded(lvl)) {
    xp -= petXpNeeded(lvl);
    lvl += 1;
    leveledUp = true;
  }
  return { level: lvl, xp, leveledUp };
}

function feedPet(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const pet = getSyncedPet(jid);
  if (!pet) return { ok: false, reason: 'no_pet' };

  const foodCost = 50;
  const deduct = deductBalance(jid, foodCost);
  if (!deduct.ok) {
    return { ok: false, reason: 'insufficient_balance', cost: foodCost };
  }

  const nextHunger = Math.min(100, pet.hunger + 35);
  const nextHappy = Math.min(100, pet.happiness + 12);
  const nextEnergy = Math.min(100, pet.energy + 10);
  const xpState = addPetXpInternal(pet, 28);

  getDb().run(
    `UPDATE pets
     SET hunger = ?, happiness = ?, energy = ?, level = ?, xp = ?, last_fed = ?
     WHERE jid = ?`,
    [nextHunger, nextHappy, nextEnergy, xpState.level, xpState.xp, Date.now(), jid]
  );

  return {
    ok: true,
    cost: foodCost,
    newBalance: deduct.newBalance,
    leveledUp: xpState.leveledUp,
    pet: getSyncedPet(jid),
  };
}

function playWithPet(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const pet = getSyncedPet(jid);
  if (!pet) return { ok: false, reason: 'no_pet' };

  if (pet.energy < 20) {
    return { ok: false, reason: 'too_tired', pet };
  }
  if (pet.hunger < 20) {
    return { ok: false, reason: 'too_hungry', pet };
  }

  const nextEnergy = Math.max(0, pet.energy - 22);
  const nextHunger = Math.max(10, pet.hunger - 10);
  const nextHappy = Math.min(100, pet.happiness + 26);
  const xpState = addPetXpInternal(pet, 38);

  // Peluang pet menemukan koin harta karun kecil untuk tuannya!
  const foundCoins = crypto.randomInt(25, 95) + pet.level * 5;
  const walletAfter = addBalance(jid, foundCoins);

  getDb().run(
    `UPDATE pets
     SET hunger = ?, happiness = ?, energy = ?, level = ?, xp = ?, last_played = ?
     WHERE jid = ?`,
    [nextHunger, nextHappy, nextEnergy, xpState.level, xpState.xp, Date.now(), jid]
  );

  return {
    ok: true,
    foundCoins,
    newBalance: walletAfter.newBalance,
    leveledUp: xpState.leveledUp,
    pet: getSyncedPet(jid),
  };
}

function restPet(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const pet = getSyncedPet(jid);
  if (!pet) return { ok: false, reason: 'no_pet' };

  getDb().run(
    'UPDATE pets SET energy = 100, happiness = MIN(100, happiness + 8), last_played = ? WHERE jid = ?',
    [Date.now(), jid]
  );
  return { ok: true, pet: getSyncedPet(jid) };
}

function renamePet(rawJid, newName) {
  const jid = normalizeUserJid(rawJid);
  const pet = getSyncedPet(jid);
  if (!pet) return { ok: false, reason: 'no_pet' };

  const clean = String(newName || '')
    .replace(/[^\w\s.'-]/g, '')
    .trim()
    .slice(0, 24);
  if (clean.length < 2) return { ok: false, reason: 'invalid_name' };

  getDb().run('UPDATE pets SET pet_name = ? WHERE jid = ?', [clean, jid]);
  return { ok: true, newName: clean };
}

// =====================================================================
// 3. TOKO KUSTOMISASI KARTU PROFIL (Background, Bingkai, Gelar)
// =====================================================================

const PROFILE_SHOP_ITEMS = Object.freeze({
  // Background Kartu Profil
  bg_pink_sakura: {
    id: 'bg_pink_sakura',
    type: 'bg',
    value: 'pink-sakura',
    name: 'Kelopak Sakura Pink (Bawaan)',
    cost: 0,
  },
  bg_starlight: {
    id: 'bg_starlight',
    type: 'bg',
    value: 'starlight-night',
    name: 'Langit Bintang Malam',
    cost: 1200,
  },
  bg_mint: {
    id: 'bg_mint',
    type: 'bg',
    value: 'mint-meadow',
    name: 'Padang Rumput Mint',
    cost: 1200,
  },
  bg_sunset: {
    id: 'bg_sunset',
    type: 'bg',
    value: 'sunset-shrine',
    name: 'Senja Kuil Emas',
    cost: 1500,
  },

  // Bingkai Kartu Profil
  frame_pastel: {
    id: 'frame_pastel',
    type: 'frame',
    value: 'pastel-ribbon',
    name: 'Pita Pastel Sakura (Bawaan)',
    cost: 0,
  },
  frame_crystal: {
    id: 'frame_crystal',
    type: 'frame',
    value: 'crystal-starlight',
    name: 'Bingkai Kristal Bintang',
    cost: 1000,
  },
  frame_emerald: {
    id: 'frame_emerald',
    type: 'frame',
    value: 'emerald-clover',
    name: 'Bingkai Zamrud Semanggi',
    cost: 1000,
  },
  frame_gold: {
    id: 'frame_gold',
    type: 'frame',
    value: 'royal-gold',
    name: 'Bingkai Mahkota Emas',
    cost: 1800,
  },

  // Gelar Kustom Profil
  title_ksatria: {
    id: 'title_ksatria',
    type: 'title',
    value: 'Ksatria Sakura',
    name: 'Gelar: Ksatria Sakura',
    cost: 800,
  },
  title_arsitek: {
    id: 'title_arsitek',
    type: 'title',
    value: 'Arsitek CipiSMP',
    name: 'Gelar: Arsitek CipiSMP',
    cost: 900,
  },
  title_kolektor: {
    id: 'title_kolektor',
    type: 'title',
    value: 'Kolektor Waifu',
    name: 'Gelar: Kolektor Waifu',
    cost: 1100,
  },
  title_legenda: {
    id: 'title_legenda',
    type: 'title',
    value: 'Legenda CipiSMP',
    name: 'Gelar: Legenda CipiSMP',
    cost: 2000,
  },
});

function applyProfileCustomizationColumn(jid, item) {
  const db = getDb();
  const now = Date.now();
  if (item.type === 'bg') {
    db.run('UPDATE users SET profile_bg = ?, updated_at = ? WHERE jid = ?', [
      item.value,
      now,
      jid,
    ]);
  } else if (item.type === 'frame') {
    db.run('UPDATE users SET profile_frame = ?, updated_at = ? WHERE jid = ?', [
      item.value,
      now,
      jid,
    ]);
  } else if (item.type === 'title') {
    db.run('UPDATE users SET title = ?, updated_at = ? WHERE jid = ?', [
      item.value,
      now,
      jid,
    ]);
  }
}

function buyOrEquipShopItem(rawJid, itemIdInput) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);
  const key = String(itemIdInput || '').toLowerCase().trim();
  const item = PROFILE_SHOP_ITEMS[key];
  if (!item) {
    return { ok: false, reason: 'invalid_item' };
  }

  const db = getDb();
  const owned = db.get(
    'SELECT * FROM inventory WHERE jid = ? AND item_id = ?',
    [jid, item.id]
  );

  // Jika item gratis bawaan atau sudah dibeli -> langsung pasang!
  if (item.cost === 0 || owned) {
    db.transaction(() => {
      db.run(
        'UPDATE inventory SET equipped = 0 WHERE jid = ? AND item_type = ?',
        [jid, item.type]
      );
      if (owned) {
        db.run('UPDATE inventory SET equipped = 1 WHERE id = ?', [owned.id]);
      }
      applyProfileCustomizationColumn(jid, item);
    });
    return {
      ok: true,
      alreadyOwned: true,
      item,
      newBalance: getEconomy(jid).balance,
    };
  }

  const deduct = deductBalance(jid, item.cost);
  if (!deduct.ok) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      cost: item.cost,
      balance: getEconomy(jid).balance,
      item,
    };
  }

  db.transaction(() => {
    db.run(
      'UPDATE inventory SET equipped = 0 WHERE jid = ? AND item_type = ?',
      [jid, item.type]
    );
    db.run(
      `INSERT INTO inventory (jid, item_id, item_type, item_name, quantity, equipped, acquired_at)
       VALUES (?, ?, ?, ?, 1, 1, ?)`,
      [jid, item.id, item.type, item.name, Date.now()]
    );
    applyProfileCustomizationColumn(jid, item);
  });

  return {
    ok: true,
    alreadyOwned: false,
    item,
    newBalance: deduct.newBalance,
  };
}

function getUserOwnedShopIds(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const rows = getDb().all('SELECT item_id FROM inventory WHERE jid = ?', [jid]);
  const set = new Set(['bg_pink_sakura', 'frame_pastel']);
  for (const r of rows) set.add(r.item_id);
  return set;
}

// =====================================================================
// 4. PENGINGAT ULANG TAHUN MEMBER (.ultah + CRON HARIAN WIB)
// =====================================================================

const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES_ID = [
  '',
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Terima format DD-MM atau DD/MM (contoh: "14-02" -> "02-14")
 */
function parseBirthdayDdMm(rawInput = '') {
  const m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?$/.exec(
    String(rawInput || '').trim()
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month]) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    mmDd: `${mm}-${dd}`,
    humanLabel: `${day} ${MONTH_NAMES_ID[month]}`,
  };
}

function formatMmDdHuman(mmDd = '') {
  const [mm, dd] = String(mmDd || '').split('-').map(Number);
  if (!mm || !dd || !MONTH_NAMES_ID[mm]) return mmDd;
  return `${dd} ${MONTH_NAMES_ID[mm]}`;
}

function setUserBirthday(rawJid, rawInput) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);
  const parsed = parseBirthdayDdMm(rawInput);
  if (!parsed) return { ok: false };

  getDb().run('UPDATE users SET birthday = ?, updated_at = ? WHERE jid = ?', [
    parsed.mmDd,
    Date.now(),
    jid,
  ]);
  return { ok: true, ...parsed };
}

function clearUserBirthday(rawJid) {
  const jid = normalizeUserJid(rawJid);
  getDb().run('UPDATE users SET birthday = NULL, updated_at = ? WHERE jid = ?', [
    Date.now(),
    jid,
  ]);
  return { ok: true };
}

function listUpcomingBirthdays(limit = 12) {
  const rows = getDb().all(
    'SELECT jid, name, birthday, level FROM users WHERE birthday IS NOT NULL AND is_banned = 0'
  );
  const parts = getWibParts();
  const todayMmDd = `${parts.month}-${parts.day}`;

  const decorated = rows.map((r) => {
    const key = r.birthday >= todayMmDd ? `0:${r.birthday}` : `1:${r.birthday}`;
    return {
      ...r,
      isToday: r.birthday === todayMmDd,
      sortKey: key,
      humanDate: formatMmDdHuman(r.birthday),
    };
  });

  decorated.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return decorated.slice(0, limit);
}

async function runDailyBirthdayCheck() {
  const parts = getWibParts();
  const todayKey = parts.dateKey;
  const todayMmDd = `${parts.month}-${parts.day}`;
  const flagKey = `bday_celebrated:${todayKey}`;

  if (getSetting(flagKey, 'false') === 'true') {
    return { celebrated: 0 };
  }

  const bdayUsers = getDb().all(
    'SELECT jid, name FROM users WHERE birthday = ? AND is_banned = 0',
    [todayMmDd]
  );

  setSetting(flagKey, 'true');
  if (bdayUsers.length === 0) return { celebrated: 0 };

  const mentions = bdayUsers.map((u) => u.jid);
  const namesLines = bdayUsers.map((u) => {
    addBalance(u.jid, 1000);
    addXp(u.jid, 150);
    const phone = extractPhoneFromJid(u.jid);
    return `🎂 @${phone || u.jid} (${keep(u.name)})`;
  });

  const bdayBox = renderBox(
    '🎉 sᴇʟᴀᴍᴀᴛ ᴜʟᴀɴɢ ᴛᴀʜᴜɴ ᴡᴀʀɢᴀ ᴄɪᴘɪsᴍᴘ!',
    [
      `✦ Hari ini (${keep(formatMmDdHuman(todayMmDd))}) adalah hari spesial sahabat kita:`,
      ...namesLines,
      '',
      `✦ Kado Otomatis: +1.000 ${config.economy.currencyName} & +150 XP telah dikirim!`,
      '◦ Semoga panjang umur, sehat selalu, dan makin bahagia ya! 🌸♡',
    ],
    { footer: config.footer }
  );

  if (activeWaSock && !config.dryRun) {
    const groups = getDb().all(
      'SELECT jid FROM groups WHERE welcome_enabled = 1 AND is_muted = 0'
    );
    for (const g of groups) {
      await activeWaSock
        .sendMessage(g.jid, { text: bdayBox, mentions })
        .catch(() => {});
    }
  }

  addAuditLog({
    category: 'birthday',
    actorJid: 'scheduler',
    target: todayMmDd,
    action: 'birthday_gift_sent',
    details: { count: bdayUsers.length },
  });

  return { celebrated: bdayUsers.length, bdayBox };
}

// =====================================================================
// 5. GAME HIBURAN (Kuis, Tebak Gambar, Ramalan, Quotes Anime, Suit, Slot)
// =====================================================================

const TRIVIA_BANK = Object.freeze([
  { q: 'Block apa di Minecraft yang diperlukan minimal 10 buah untuk membuat Nether Portal?', a: ['obsidian'], hint: 'Berwarna ungu kehitaman sangat keras', cat: 'Minecraft' },
  { q: 'Mob apa di Minecraft yang takut terhadap Kucing (Cat) dan Ocelot?', a: ['creeper'], hint: 'Suka meledak diam-diam dari belakang', cat: 'Minecraft' },
  { q: 'Enchantment apa yang bisa memperbaiki daya tahan item menggunakan bola XP?', a: ['mending'], hint: 'Buku langka favorit dari Villager Librarian', cat: 'Minecraft' },
  { q: 'Dimensi tempat tinggal Ender Dragon di Minecraft disebut dimensi apa?', a: ['the end', 'end'], hint: 'Dimensi pulau batu kuning pucat', cat: 'Minecraft' },
  { q: 'Plugin/jembatan apa yang memungkinkan pemain Minecraft Bedrock masuk ke server Java?', a: ['geyser', 'geysermc'], hint: 'Dipakai juga di server CipiSMP!', cat: 'Minecraft' },
  { q: 'Siapakah nama penyihir elf berambut putih panjang di anime Sousou no Frieren?', a: ['frieren'], hint: 'Rekan satu party pahlawan Himmel', cat: 'Anime' },
  { q: 'Di anime Kimetsu no Yaiba, apa nama adik perempuan Kamado Tanjiro?', a: ['nezuko', 'kamado nezuko'], hint: 'Menggigit bambu hijau', cat: 'Anime' },
  { q: 'Siapakah kapten bajak laut Topi Jerami di anime One Piece?', a: ['luffy', 'monkey d luffy', 'monkey d. luffy'], hint: 'Pemakan buah Gomu Gomu', cat: 'Anime' },
  { q: 'Apa nama desa tempat tinggal Naruto Uzumaki?', a: ['konoha', 'konohagakure'], hint: 'Desa Daun Tersembunyi', cat: 'Anime' },
  { q: 'Di anime Spy x Family, siapa nama gadis kecil yang bisa membaca pikiran?', a: ['anya', 'anya forger'], hint: 'Suka kacang tanah (peanuts)!', cat: 'Anime' },
  { q: 'Kota manakah di Jawa Timur yang dijuluki sebagai Kota Pahlawan?', a: ['surabaya'], hint: 'Ibu kota Provinsi Jawa Timur', cat: 'Umum' },
  { q: 'Planet manakah di Tata Surya yang terkenal memiliki cincin paling besar dan indah?', a: ['saturnus'], hint: 'Planet keenam dari Matahari', cat: 'Sains' },
]);

const TEBAK_GAMBAR_BANK = Object.freeze([
  { clues: ['KUCING', '+ AIR', '- ING'], answer: 'kucair', alt: [], valid: false },
].filter((x) => x.valid).concat([
  {
    clues: ['JAM', '+ TANGAN'],
    answer: 'jam tangan',
    aliases: ['jamtangan'],
    category: 'Benda Sehari-hari',
    hint: 'Dipakai melingkar di pergelangan untuk melihat waktu',
  },
  {
    clues: ['KAMBING', '+ HITAM'],
    answer: 'kambing hitam',
    aliases: ['kambinghitam'],
    category: 'Ungkapan Bahasa',
    hint: 'Orang yang dipersalahkan padahal tidak berbuat',
  },
  {
    clues: ['BUAH', '+ TANGAN'],
    answer: 'buah tangan',
    aliases: ['buahtangan'],
    category: 'Ungkapan Bahasa',
    hint: 'Oleh-oleh saat pulang bepergian',
  },
  {
    clues: ['KAKI', '+ LIMA'],
    answer: 'kaki lima',
    aliases: ['kakilima'],
    category: 'Istilah Umum',
    hint: 'Pedagang gerobak di tepi jalan',
  },
  {
    clues: ['MEJA', '+ HIJAU'],
    answer: 'meja hijau',
    aliases: ['mejahijau'],
    category: 'Ungkapan Bahasa',
    hint: 'Sebutan kiasan untuk ruang pengadilan',
  },
  {
    clues: ['BUNGA', '+ TIDUR'],
    answer: 'bunga tidur',
    aliases: ['bungatidur'],
    category: 'Ungkapan Bahasa',
    hint: 'Nama puitis untuk mimpi di malam hari',
  },
  {
    clues: ['KUTU', '+ BUKU'],
    answer: 'kutu buku',
    aliases: ['kutubuku'],
    category: 'Ungkapan Bahasa',
    hint: 'Julukan bagi orang yang sangat gemar membaca',
  },
  {
    clues: ['PEDANG', '+ BERLIAN'],
    answer: 'pedang berlian',
    aliases: ['pedangberlian', 'diamond sword'],
    category: 'Item Minecraft',
    hint: 'Senjata biru berkilau andalan petualang Minecraft',
  },
]));

function maskAnswerPattern(answer = '') {
  return String(answer)
    .toUpperCase()
    .split(' ')
    .map((word) => word.split('').map(() => '_').join(' '))
    .join('    ');
}

function normalizeAnswerText(raw = '') {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function startQuizSession(chatJid, durationMs = 45000) {
  const existing = activeChatGames.get(chatJid);
  if (existing && existing.expiresAt > Date.now()) {
    return { ok: false, existing };
  }

  const item = TRIVIA_BANK[crypto.randomInt(0, TRIVIA_BANK.length)];
  const rewardCoins = 220;
  const rewardXp = 45;
  const expiresAt = Date.now() + durationMs;

  const timer = setTimeout(() => {
    activeChatGames.delete(chatJid);
  }, durationMs);
  if (typeof timer.unref === 'function') timer.unref();

  const session = {
    type: 'kuis',
    question: item.q,
    category: item.cat,
    hint: item.hint,
    answers: item.a.map(normalizeAnswerText),
    displayAnswer: item.a[0].toUpperCase(),
    rewardCoins,
    rewardXp,
    expiresAt,
    timer,
  };
  activeChatGames.set(chatJid, session);
  return { ok: true, session };
}

function startTebakGambarSession(chatJid, durationMs = 60000) {
  const existing = activeChatGames.get(chatJid);
  if (existing && existing.expiresAt > Date.now()) {
    return { ok: false, existing };
  }

  const item = TEBAK_GAMBAR_BANK[crypto.randomInt(0, TEBAK_GAMBAR_BANK.length)];
  const rewardCoins = 260;
  const rewardXp = 55;
  const expiresAt = Date.now() + durationMs;

  const timer = setTimeout(() => {
    activeChatGames.delete(chatJid);
  }, durationMs);
  if (typeof timer.unref === 'function') timer.unref();

  const allAccepted = [item.answer, ...(item.aliases || [])].map(normalizeAnswerText);
  const session = {
    type: 'tebakgambar',
    clues: item.clues,
    category: item.category,
    hint: item.hint,
    answerMask: maskAnswerPattern(item.answer),
    answers: allAccepted,
    displayAnswer: item.answer.toUpperCase(),
    rewardCoins,
    rewardXp,
    expiresAt,
    timer,
  };
  activeChatGames.set(chatJid, session);
  return { ok: true, session };
}

function getActiveGameSession(chatJid) {
  const s = activeChatGames.get(chatJid);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    if (s.timer) clearTimeout(s.timer);
    activeChatGames.delete(chatJid);
    return null;
  }
  return s;
}

function forfeitActiveGameSession(chatJid) {
  const s = getActiveGameSession(chatJid);
  if (!s) return null;
  if (s.timer) clearTimeout(s.timer);
  activeChatGames.delete(chatJid);
  return s;
}

function checkGameAnswer(chatJid, rawSenderJid, rawInput) {
  const s = getActiveGameSession(chatJid);
  if (!s) return { matched: false };

  const cleaned = normalizeAnswerText(rawInput);
  if (!cleaned) return { matched: false };

  if (!s.answers.includes(cleaned)) {
    return { matched: false };
  }

  if (s.timer) clearTimeout(s.timer);
  activeChatGames.delete(chatJid);

  const jid = normalizeUserJid(rawSenderJid);
  const walletAfter = addBalance(jid, s.rewardCoins);
  const xpRes = addXp(jid, s.rewardXp);

  return {
    matched: true,
    gameType: s.type,
    displayAnswer: s.displayAnswer,
    rewardCoins: s.rewardCoins,
    rewardXp: s.rewardXp,
    newBalance: walletAfter.newBalance,
    xpResult: xpRes,
  };
}

/**
 * Ramalan Harian / Omikuji Kuil Sakura (deterministik per user per tanggal WIB)
 */
const OMIKUJI_FORTUNES = Object.freeze([
  {
    grade: '✿ DAI-KICHI (Keberuntungan Agung!)',
    stars: '★★★★★',
    love: 'Senyum hangatmu hari ini bikin suasana hati semua orang ikut berbunga-bunga ♡',
    mcLuck: 'Saat paling hoki untuk menambang di Y=-58 atau memutar Gacha!',
    color: 'Pink Sakura & Emas',
    bonusCoins: 150,
  },
  {
    grade: '✦ CHUU-KICHI (Keberuntungan Besar)',
    stars: '★★★★☆',
    love: 'Ada obrolan seru yang tak terduga dengan teman lama hari ini~',
    mcLuck: 'Proyek bangunan di CipiSMP bakal selesai rapi tanpa gangguan Creeper!',
    color: 'Biru Langit & Putih',
    bonusCoins: 110,
  },
  {
    grade: '❖ SHOU-KICHI (Keberuntungan Manis)',
    stars: '★★★★☆',
    love: 'Perhatian kecil yang tulus membawa kebahagiaan besar hari ini ♡',
    mcLuck: 'Hasil panen kebun dan pancingan di sungai terasa ekstra melimpah!',
    color: 'Hijau Mint',
    bonusCoins: 90,
  },
  {
    grade: '✿ KICHI (Hari yang Cerah & Tenang)',
    stars: '★★★☆☆',
    love: 'Nikmati waktumu dengan santai, energi positifmu sangat menenangkan~',
    mcLuck: 'Jangan lupa bawa obor dan roti yang cukup sebelum masuk ke gua ya!',
    color: 'Ungu Lavender',
    bonusCoins: 75,
  },
  {
    grade: '♡ SUE-KICHI (Berkah di Penghujung Hari)',
    stars: '★★★☆☆',
    love: 'Kesabaranmu hari ini akan berbuah kejutan manis nanti malam!',
    mcLuck: 'Simpan berlianmu di Ender Chest agar tetap aman sentosa~',
    color: 'Kuning Lemon',
    bonusCoins: 65,
  },
]);

function drawDailyFortune(rawJid) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);
  const today = getWibDateKey();
  const hashBuf = crypto.createHash('sha256').update(`${jid}:${today}`).digest();
  const idx = hashBuf[0] % OMIKUJI_FORTUNES.length;
  const luckyNumber = (hashBuf[1] % 99) + 1;
  const fortune = OMIKUJI_FORTUNES[idx];

  // Berkah koin kuil 1x sehari
  const claimKey = `omikuji:${today}:${jid}`;
  let grantedBonus = 0;
  if (getSetting(claimKey, 'false') !== 'true') {
    setSetting(claimKey, 'true');
    addBalance(jid, fortune.bonusCoins);
    grantedBonus = fortune.bonusCoins;
  }

  return {
    today,
    luckyNumber,
    grantedBonus,
    ...fortune,
  };
}

/**
 * Koleksi Kutipan Anime Bahasa Indonesia Pilihan (.quotes)
 */
const ANIME_QUOTES = Object.freeze([
  { quote: 'Bukan karena hal itu sulit maka kita tidak berani, tetapi karena kita tidak berani maka hal itu terasa sulit.', char: 'Himmel sang Pahlawan', anime: 'Sousou no Frieren' },
  { quote: 'Sekalipun langkahmu pelan, selama kamu tidak berhenti berjalan, kamu pasti akan sampai di tujuan.', char: 'Kamado Tanjiro', anime: 'Kimetsu no Yaiba' },
  { quote: 'Menangis bukanlah tanda kelemahan. Sejak lahir, menangis adalah tanda bahwa seseorang hidup dan berjuang.', char: 'Violet Evergarden', anime: 'Violet Evergarden' },
  { quote: 'Orang yang tidak menghargai teman-temannya lebih buruk daripada mereka yang melanggar aturan.', char: 'Hatake Kakashi', anime: 'Naruto' },
  { quote: 'Kegagalan hari ini adalah bekal terbaik untuk melompat lebih tinggi esok hari!', char: 'Hinata Shoyo', anime: 'Haikyuu!!' },
  { quote: 'Keajaiban tidak turun begitu saja dari langit, kitalah yang menciptakannya dengan tangan kita sendiri.', char: 'Monkey D. Luffy', anime: 'One Piece' },
  { quote: 'Kenangan indah yang kita buat bersama tidak akan pernah pudar meski musim terus berganti.', char: 'Kaori Miyazono', anime: 'Shigatsu wa Kimi no Uso' },
  { quote: 'Tidak apa-apa merasa takut, karena keberanian sejati lahir saat kamu melangkah meski sedang gemetar.', char: 'Midoriya Izuku', anime: 'Boku no Hero Academia' },
  { quote: 'Hal-hal kecil yang kita nikmati bersama teman adalah harta karun paling berharga dalam petualangan.', char: 'Frieren', anime: 'Sousou no Frieren' },
  { quote: 'Jangan bandingkan kecepatan mekarnya bungamu dengan bunga milik orang lain. Setiap musim punya waktunya sendiri.', char: 'Tohru Honda', anime: 'Fruits Basket' },
]);

function getRandomAnimeQuote() {
  return ANIME_QUOTES[crypto.randomInt(0, ANIME_QUOTES.length)];
}

/**
 * Permainan Suit Jepang / Batu-Gunting-Kertas (.suit)
 */
function playRockPaperScissors(rawJid, rawChoice, wagerInput = 0) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);

  const mapAlias = {
    batu: 'batu', rock: 'batu',
    gunting: 'gunting', scissors: 'gunting',
    kertas: 'kertas', paper: 'kertas',
  };
  const userChoice = mapAlias[String(rawChoice || '').toLowerCase().trim()];
  if (!userChoice) return { ok: false, reason: 'invalid_choice' };

  const bet = Math.max(0, Math.min(2000, Math.floor(Number(wagerInput || 0))));
  const wallet = getEconomy(jid);
  if (bet > 0 && wallet.balance < bet) {
    return { ok: false, reason: 'insufficient_balance', balance: wallet.balance, bet };
  }

  const options = ['batu', 'gunting', 'kertas'];
  const botChoice = options[crypto.randomInt(0, 3)];
  const icons = { batu: '🪨 Batu', gunting: '✂️ Gunting', kertas: '📄 Kertas' };

  let outcome = 'draw';
  if (userChoice !== botChoice) {
    const winPairs = { batu: 'gunting', gunting: 'kertas', kertas: 'batu' };
    outcome = winPairs[userChoice] === botChoice ? 'win' : 'lose';
  }

  let coinDelta = 0;
  if (bet > 0) {
    if (outcome === 'win') {
      addBalance(jid, bet);
      coinDelta = bet;
    } else if (outcome === 'lose') {
      deductBalance(jid, bet);
      coinDelta = -bet;
    }
  } else if (outcome === 'win') {
    // Mode santai tanpa taruhan tetap memberi hadiah hiburan kecil!
    addBalance(jid, 35);
    coinDelta = 35;
  }

  return {
    ok: true,
    userChoice,
    botChoice,
    userLabel: icons[userChoice],
    botLabel: icons[botChoice],
    outcome,
    bet,
    coinDelta,
    newBalance: getEconomy(jid).balance,
  };
}

/**
 * Mesin Slot Koin Kawaii (.slot)
 */
const SLOT_SYMBOLS = Object.freeze([
  { sym: '🌸', weight: 30, mult3: 3 },
  { sym: '🍓', weight: 26, mult3: 4 },
  { sym: '🍡', weight: 20, mult3: 5 },
  { sym: '⭐', weight: 13, mult3: 8 },
  { sym: '💎', weight: 8, mult3: 12 },
  { sym: '👑', weight: 3, mult3: 20 },
]);

function rollWeightedSlotSymbol() {
  const totalW = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);
  let r = crypto.randomInt(0, totalW);
  for (const item of SLOT_SYMBOLS) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return SLOT_SYMBOLS[0];
}

function spinKawaiiSlot(rawJid, betAmount = 100) {
  const jid = normalizeUserJid(rawJid);
  ensureUser(jid);

  const bet = Math.floor(Number(betAmount || 100));
  if (!Number.isFinite(bet) || bet < 50 || bet > 2500) {
    return { ok: false, reason: 'invalid_bet' };
  }

  const wallet = getEconomy(jid);
  if (wallet.balance < bet) {
    return { ok: false, reason: 'insufficient_balance', balance: wallet.balance, bet };
  }

  deductBalance(jid, bet);

  const r1 = rollWeightedSlotSymbol();
  const r2 = rollWeightedSlotSymbol();
  const r3 = rollWeightedSlotSymbol();

  let multiplier = 0;
  let winType = 'lose';

  if (r1.sym === r2.sym && r2.sym === r3.sym) {
    multiplier = r1.mult3;
    winType = 'jackpot';
  } else if (r1.sym === r2.sym || r2.sym === r3.sym || r1.sym === r3.sym) {
    multiplier = 1.6;
    winType = 'pair';
  }

  const payout = multiplier > 0 ? Math.round(bet * multiplier) : 0;
  if (payout > 0) {
    addBalance(jid, payout);
  }

  return {
    ok: true,
    reels: [r1.sym, r2.sym, r3.sym],
    bet,
    payout,
    netProfit: payout - bet,
    winType,
    multiplier,
    newBalance: getEconomy(jid).balance,
  };
}

// =====================================================================
// 6. REGISTRASI HOOK KE INDEX.JS (Jawaban Kuis/TebakGambar & Cron Ultah)
// =====================================================================

function stopKawaiiSchedulers() {
  if (birthdayCronTask) {
    birthdayCronTask.stop();
    birthdayCronTask = null;
  }
  for (const s of activeChatGames.values()) {
    if (s.timer) clearTimeout(s.timer);
  }
  activeChatGames.clear();
}

function register({ registerHook }) {
  if (!birthdayCronTask) {
    birthdayCronTask = cron.schedule(
      '5 8 * * *',
      () => {
        runDailyBirthdayCheck().catch((err) =>
          logger.error('ULTAH', 'Gagal menjalankan pengecekan ulang tahun harian', err)
        );
      },
      { timezone: config.timezone || 'Asia/Jakarta' }
    );
  }

  registerHook('onSocketReady', async (sock) => {
    activeWaSock = sock;
    const { hourNum } = getWibParts();
    if (hourNum >= 8) {
      await runDailyBirthdayCheck().catch(() => {});
    }
  });

  // Tangkap jawaban langsung di chat apabila ada sesi Kuis / Tebak Gambar aktif!
  registerHook('onMessagePreCommand', async ({ sock, msg, chatJid, senderJid, body, userRow }) => {
    if (msg?.key?.fromMe || !chatJid || !body || userRow?.is_banned) return;
    const trimmed = String(body).trim();
    if (!trimmed || trimmed.startsWith(config.prefix || '.')) return;

    const match = checkGameAnswer(chatJid, senderJid, trimmed);
    if (match.matched && sock) {
      const phone = extractPhoneFromJid(senderJid);
      await sock
        .sendMessage(
          chatJid,
          {
            text: formatSuccess('Jawaban Tepat Sekali! 🎉', [
              `✦ Pemenang : @${phone || senderJid}`,
              `✦ Jawaban  : ${keep(match.displayAnswer)}`,
              `✦ Hadiah   : +${formatNumber(match.rewardCoins)} ${config.economy.currencyName} & +${match.rewardXp} XP`,
              `◦ Saldo Sekarang: ${formatNumber(match.newBalance)} ${config.economy.currencyName} ♡`,
            ]),
            mentions: [senderJid],
          },
          { quoted: msg }
        )
        .catch(() => {});
    }
  });

  process.once('SIGINT', () => stopKawaiiSchedulers());
  process.once('SIGTERM', () => stopKawaiiSchedulers());

  logger.info('KAWAII', 'Modul Gacha, Pet Virtual, Toko Profil, Ultah WIB & Game Hiburan aktif');
}

module.exports = {
  GACHA_CHARACTERS,
  SHARD_EXCHANGE_COST,
  PET_SPECIES,
  PROFILE_SHOP_ITEMS,
  performGachaPull,
  redeemCharacterWithShards,
  getUserGachaSummary,
  getSyncedPet,
  adoptPet,
  feedPet,
  playWithPet,
  restPet,
  renamePet,
  buyOrEquipShopItem,
  getUserOwnedShopIds,
  parseBirthdayDdMm,
  formatMmDdHuman,
  setUserBirthday,
  clearUserBirthday,
  listUpcomingBirthdays,
  runDailyBirthdayCheck,
  startQuizSession,
  startTebakGambarSession,
  getActiveGameSession,
  forfeitActiveGameSession,
  checkGameAnswer,
  drawDailyFortune,
  getRandomAnimeQuote,
  playRockPaperScissors,
  spinKawaiiSlot,
  stopKawaiiSchedulers,
  register,
};
