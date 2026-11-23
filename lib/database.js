const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logger } = require('./logger');

fs.mkdirSync(config.paths.databaseDir, { recursive: true });

let adapter = null;
let activeDriver = 'uninitialized';

// Cache pemetaan Linked ID WhatsApp Multi-Device (@lid -> @s.whatsapp.net)
const lidToPnCache = new Map();

/**
 * Ekstrak digit nomor telepon bersih dari JID WhatsApp
 * Menangani format 628xxx@s.whatsapp.net maupun 628xxx:12@s.whatsapp.net
 * @param {string} jid
 * @returns {string}
 */
function extractPhoneFromJid(jid = '') {
  if (!jid) return '';
  const resolved = lidToPnCache.get(String(jid).trim()) || String(jid).trim();
  const [localPart = '', domain = ''] = resolved.split('@');
  if (domain === 'lid') return '';
  const withoutDevice = localPart.split(':')[0] || '';
  return withoutDevice.replace(/[^0-9]/g, '');
}

/**
 * Normalisasi JID user ke bentuk kanonik <nomor>@s.whatsapp.net
 * Otomatis menerjemahkan @lid ke @s.whatsapp.net bila pemetaannya sudah diketahui!
 * @param {string} jid
 * @returns {string}
 */
function normalizeUserJid(jid = '') {
  if (!jid) return '';
  const raw = String(jid).trim();
  if (raw.endsWith('@g.us') || raw.endsWith('@newsletter') || raw.endsWith('@broadcast')) {
    return raw;
  }
  const [left, domain = 's.whatsapp.net'] = raw.split('@');
  const cleanLeft = (left || '').split(':')[0];
  if (domain === 'lid') {
    const lidKey = `${cleanLeft}@lid`;
    const mappedPn = lidToPnCache.get(lidKey);
    if (mappedPn) return mappedPn;
    const digitsOnly = cleanLeft.replace(/[^0-9]/g, '');
    if (digitsOnly && lidToPnCache.has(`${digitsOnly}@lid`)) {
      return lidToPnCache.get(`${digitsOnly}@lid`);
    }
    return lidKey;
  }
  const digits = cleanLeft.replace(/[^0-9]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : `${cleanLeft}@${domain}`;
}

/**
 * Daftarkan pasangan @lid <-> @s.whatsapp.net dari metadata grup / pesan masuk Baileys v7
 * Sekaligus menyatukan data tiket/VIP lama yang sempat tercatat memakai @lid
 */
function registerLidMapping(rawLid = '', rawPn = '') {
  if (!rawLid || !rawPn) return null;
  const lidStr = String(rawLid).trim();
  const pnStr = String(rawPn).trim();
  if (!lidStr.endsWith('@lid') || pnStr.endsWith('@lid')) return null;

  const lidClean = `${(lidStr.split('@')[0] || '').split(':')[0]}@lid`;
  const pnDigits = ((pnStr.split('@')[0] || '').split(':')[0] || '').replace(/[^0-9]/g, '');
  if (!lidClean || !pnDigits) return null;

  const canonicalPn = `${pnDigits}@s.whatsapp.net`;
  const prev = lidToPnCache.get(lidClean);
  lidToPnCache.set(lidClean, canonicalPn);

  if (adapter && prev !== canonicalPn) {
    try {
      // Migrasikan tiket atau VIP lama yang sempat tersimpan memakai @lid
      adapter.run('UPDATE tickets SET jid = ? WHERE jid = ?', [canonicalPn, lidClean]);
      const oldPrem = adapter.get('SELECT * FROM premium WHERE jid = ?', [lidClean]);
      if (oldPrem) {
        const curPrem = adapter.get('SELECT * FROM premium WHERE jid = ?', [canonicalPn]);
        if (!curPrem || Number(oldPrem.expires_at || 0) > Number(curPrem.expires_at || 0)) {
          adapter.run(
            `INSERT INTO premium (jid, tier, expires_at, granted_by, note, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(jid) DO UPDATE SET
               tier = excluded.tier,
               expires_at = excluded.expires_at,
               granted_by = excluded.granted_by,
               note = excluded.note,
               active = excluded.active,
               updated_at = excluded.updated_at`,
            [
              canonicalPn,
              oldPrem.tier,
              oldPrem.expires_at,
              oldPrem.granted_by || 'owner',
              oldPrem.note || '',
              oldPrem.active ?? 1,
              oldPrem.created_at || Date.now(),
              oldPrem.updated_at || Date.now(),
            ]
          );
        }
        adapter.run('DELETE FROM premium WHERE jid = ?', [lidClean]);
      }
    } catch {
      // Abaikan bila tabel belum siap
    }
  }

  return canonicalPn;
}

/**
 * Format teks mention WhatsApp yang valid (@628xxx) untuk dipasangkan dengan array `mentions: [jid]`
 * agar otomatis berubah menjadi tag kontak berwarna biru di aplikasi WhatsApp
 */
function formatMentionTag(rawJid = '', fallbackName = 'Member') {
  const norm = normalizeUserJid(rawJid);
  if (!norm) return fallbackName;
  const phone = extractPhoneFromJid(norm);
  if (phone) return `@${phone}`;
  const local = (norm.split('@')[0] || '').split(':')[0];
  return local ? `@${local}` : fallbackName;
}

/**
 * Normalisasi username Minecraft (Java & Geyser Bedrock dengan awalan "." dan spasi)
 * @param {string} rawUsername
 */
function normalizeMinecraftUsername(rawUsername = '') {
  const bedrockPrefix = config.minecraft.bedrockPrefix || '.';
  const cleaned = String(rawUsername || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return {
      valid: false,
      raw: '',
      display: '',
      normalized: '',
      isBedrock: false,
    };
  }

  const isBedrock = cleaned.startsWith(bedrockPrefix);
  const withoutPrefix = isBedrock ? cleaned.slice(bedrockPrefix.length).trim() : cleaned;

  // Validasi karakter aman: huruf, angka, underscore, spasi (untuk Xbox Gamertag di Bedrock)
  const validPattern = isBedrock
    ? /^[A-Za-z0-9_ ]{2,32}$/
    : /^[A-Za-z0-9_]{3,16}$/;

  if (!validPattern.test(withoutPrefix)) {
    return {
      valid: false,
      raw: cleaned,
      display: cleaned,
      normalized: '',
      isBedrock,
    };
  }

  // Geyser sering mengganti spasi Gamertag menjadi underscore di beberapa plugin
  const canonicalBody = withoutPrefix.toLowerCase().replace(/\s+/g, '_');
  const display = isBedrock ? `${bedrockPrefix}${withoutPrefix}` : withoutPrefix;
  const normalized = isBedrock ? `${bedrockPrefix}${canonicalBody}` : canonicalBody;

  return {
    valid: true,
    raw: cleaned,
    display,
    normalized,
    isBedrock,
  };
}

/**
 * Daftar migrasi skema lengkap yang dirancang sejak Fase 1 agar Fase 2-7 aman tanpa merusak data
 */
const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_complete_schema',
    sql: `
      -- 1. Tabel Users (Profil, XP, Level, Ban, Ultah, Kustomisasi)
      CREATE TABLE IF NOT EXISTS users (
        jid TEXT PRIMARY KEY,
        phone TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT 'Sahabat Cipi',
        bio TEXT NOT NULL DEFAULT 'Petualang CipiSMP ♡',
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        is_banned INTEGER NOT NULL DEFAULT 0,
        ban_reason TEXT NOT NULL DEFAULT '',
        birthday TEXT DEFAULT NULL,
        profile_bg TEXT NOT NULL DEFAULT 'pink-sakura',
        profile_frame TEXT NOT NULL DEFAULT 'pastel-ribbon',
        title TEXT NOT NULL DEFAULT 'Pendatang Baru',
        playtime_minutes INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_level_xp ON users(level DESC, xp DESC);
      CREATE INDEX IF NOT EXISTS idx_users_birthday ON users(birthday);

      -- 2. Tabel Groups (Pengaturan Grup, Welcome, Antilink, Bridge)
      CREATE TABLE IF NOT EXISTS groups (
        jid TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        welcome_enabled INTEGER NOT NULL DEFAULT 1,
        welcome_text TEXT NOT NULL DEFAULT 'Selamat datang @user di @group ♡ Semoga betah ya!',
        leave_text TEXT NOT NULL DEFAULT 'Sampai jumpa @user, semoga kembali lagi ya ✿',
        antilink INTEGER NOT NULL DEFAULT 0,
        antispam INTEGER NOT NULL DEFAULT 0,
        mute INTEGER NOT NULL DEFAULT 0,
        bridge_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 3. Tabel Economy (Saldo, Bank, Shards Gacha, Cooldown Harian/Mingguan/Kerja)
      CREATE TABLE IF NOT EXISTS economy (
        jid TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 500,
        bank INTEGER NOT NULL DEFAULT 0,
        gems INTEGER NOT NULL DEFAULT 0,
        gacha_shards INTEGER NOT NULL DEFAULT 0,
        pity_counter INTEGER NOT NULL DEFAULT 0,
        daily_streak INTEGER NOT NULL DEFAULT 0,
        last_daily INTEGER NOT NULL DEFAULT 0,
        last_weekly INTEGER NOT NULL DEFAULT 0,
        last_work INTEGER NOT NULL DEFAULT 0,
        total_earned INTEGER NOT NULL DEFAULT 500,
        total_spent INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_economy_balance ON economy(balance DESC);

      -- 4. Tabel Inventory (Item, Background Profil, Bingkai, Konsumabel)
      CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_type TEXT NOT NULL DEFAULT 'item',
        item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        equipped INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        acquired_at INTEGER NOT NULL,
        UNIQUE(jid, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_jid ON inventory(jid);

      -- 5. Tabel Gacha (Koleksi Karakter Waifu N/R/SR/SSR)
      CREATE TABLE IF NOT EXISTS gacha (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        character_id TEXT NOT NULL,
        character_name TEXT NOT NULL,
        rarity TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        image_file TEXT NOT NULL DEFAULT '',
        obtained_at INTEGER NOT NULL,
        last_pulled_at INTEGER NOT NULL,
        UNIQUE(jid, character_id)
      );
      CREATE INDEX IF NOT EXISTS idx_gacha_jid_rarity ON gacha(jid, rarity);

      -- 6. Tabel Pets (Pet Virtual Kawaii)
      CREATE TABLE IF NOT EXISTS pets (
        jid TEXT PRIMARY KEY,
        pet_type TEXT NOT NULL DEFAULT 'neko',
        pet_name TEXT NOT NULL DEFAULT 'Mochi',
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        hunger INTEGER NOT NULL DEFAULT 85,
        happiness INTEGER NOT NULL DEFAULT 90,
        energy INTEGER NOT NULL DEFAULT 100,
        last_fed INTEGER NOT NULL DEFAULT 0,
        last_played INTEGER NOT NULL DEFAULT 0,
        adopted_at INTEGER NOT NULL
      );

      -- 7. Tabel Tickets (Laporan User WA <-> Channel Admin Discord)
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_no TEXT NOT NULL UNIQUE,
        jid TEXT NOT NULL,
        user_name TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'umum',
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        discord_channel_id TEXT DEFAULT NULL,
        discord_message_id TEXT DEFAULT NULL,
        assigned_to TEXT DEFAULT NULL,
        resolution TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_jid_status ON tickets(jid, status);

      -- 8. Tabel Giveaways & Peserta
      CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        prize TEXT NOT NULL,
        prize_amount INTEGER NOT NULL DEFAULT 0,
        winner_count INTEGER NOT NULL DEFAULT 1,
        host_jid TEXT NOT NULL,
        group_jid TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        ends_at INTEGER NOT NULL,
        participants_json TEXT NOT NULL DEFAULT '[]',
        winners_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_giveaways_status_ends ON giveaways(status, ends_at);

      -- 9. Tabel Events (Pengingat Event Sekali / Berulang via Cron WIB)
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cron_expr TEXT DEFAULT NULL,
        run_at INTEGER DEFAULT NULL,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        platforms_json TEXT NOT NULL DEFAULT '["wa","discord","minecraft"]',
        target_groups_json TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER DEFAULT NULL,
        created_at INTEGER NOT NULL
      );

      -- 10. Tabel Links (Verifikasi Akun WA <-> Username Minecraft Java/Bedrock)
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL UNIQUE,
        mc_username TEXT NOT NULL,
        mc_normalized TEXT NOT NULL UNIQUE,
        is_bedrock INTEGER NOT NULL DEFAULT 0,
        mc_uuid TEXT DEFAULT NULL,
        verify_code TEXT DEFAULT NULL,
        verify_expires_at INTEGER DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        linked_at INTEGER DEFAULT NULL,
        daily_reward_date TEXT DEFAULT NULL,
        daily_reward_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_links_verify_code ON links(verify_code);

      -- 11. Tabel Settings (Mode Bot public/self, Maintenance, Konfigurasi Dinamis)
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 12. Tabel Premium (Status Premium Berdurasi)
      CREATE TABLE IF NOT EXISTS premium (
        jid TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'sakura',
        expires_at INTEGER NOT NULL,
        granted_by TEXT NOT NULL DEFAULT 'system',
        note TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_premium_active_exp ON premium(active, expires_at);

      -- 13. Tabel Quests (3 Misi Harian Acak per User, Reset Tengah Malam WIB)
      CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL,
        quest_date TEXT NOT NULL,
        quest_code TEXT NOT NULL,
        quest_title TEXT NOT NULL,
        target_count INTEGER NOT NULL DEFAULT 1,
        current_count INTEGER NOT NULL DEFAULT 0,
        reward_balance INTEGER NOT NULL DEFAULT 150,
        reward_xp INTEGER NOT NULL DEFAULT 50,
        claimed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(jid, quest_date, quest_code)
      );
      CREATE INDEX IF NOT EXISTS idx_quests_jid_date ON quests(jid, quest_date);

      -- 14. Tabel Logs (Audit Broadcast, Transaksi Reward, Admin, Error Penting)
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL DEFAULT 'info',
        category TEXT NOT NULL DEFAULT 'system',
        actor_jid TEXT NOT NULL DEFAULT '',
        target TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_category_created ON logs(category, created_at DESC);

      -- Tabel Pendukung Limit Harian per Fitur (Reset Tengah Malam WIB)
      CREATE TABLE IF NOT EXISTS daily_limits (
        jid TEXT NOT NULL,
        limit_date TEXT NOT NULL,
        feature TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (jid, limit_date, feature)
      );
    `,
  },
];

/**
 * Buat adapter untuk better-sqlite3 (pilihan utama)
 */
function createBetterSqliteAdapter(dbFile) {
  const Database = require('better-sqlite3');
  const rawDb = new Database(dbFile);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('synchronous = NORMAL');
  rawDb.pragma('foreign_keys = ON');
  rawDb.pragma('busy_timeout = 5000');

  return {
    driverName: 'better-sqlite3',
    exec(sql) {
      rawDb.exec(sql);
    },
    get(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      return Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
    },
    all(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      return Array.isArray(params) ? stmt.all(...params) : stmt.all(params);
    },
    run(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      const info = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
      return {
        changes: info.changes,
        lastInsertRowid: Number(info.lastInsertRowid || 0),
      };
    },
    transaction(fn) {
      const trx = rawDb.transaction(fn);
      return trx();
    },
    async backupTo(destFile) {
      await rawDb.backup(destFile);
    },
    close() {
      rawDb.close();
    },
  };
}

/**
 * Buat adapter untuk node:sqlite (built-in Node.js >= 22.5 tanpa instalasi native)
 */
function createNodeSqliteAdapter(dbFile) {
  const { DatabaseSync } = require('node:sqlite');
  const rawDb = new DatabaseSync(dbFile);
  rawDb.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');

  return {
    driverName: 'node:sqlite',
    exec(sql) {
      rawDb.exec(sql);
    },
    get(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      return Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
    },
    all(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      return Array.isArray(params) ? stmt.all(...params) : stmt.all(params);
    },
    run(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      const info = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
      return {
        changes: Number(info.changes || 0),
        lastInsertRowid: Number(info.lastInsertRowid || 0),
      };
    },
    transaction(fn) {
      rawDb.exec('BEGIN IMMEDIATE');
      try {
        const res = fn();
        rawDb.exec('COMMIT');
        return res;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    },
    async backupTo(destFile) {
      const escaped = destFile.replace(/'/g, "''");
      if (fs.existsSync(destFile)) fs.unlinkSync(destFile);
      rawDb.exec(`VACUUM INTO '${escaped}'`);
    },
    close() {
      rawDb.close();
    },
  };
}

/**
 * Buat adapter untuk sql.js (WASM murni — fallback pamungkas di semua arsitektur panel)
 */
async function createSqlJsAdapter(dbFile) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(dbFile)) {
    const existing = fs.readFileSync(dbFile);
    rawDb = new SQL.Database(existing);
  } else {
    rawDb = new SQL.Database();
  }

  let inTransaction = false;

  const persistToDisk = () => {
    if (inTransaction) return;
    const data = rawDb.export();
    const tmpFile = `${dbFile}.tmp`;
    fs.writeFileSync(tmpFile, Buffer.from(data));
    fs.renameSync(tmpFile, dbFile);
  };

  return {
    driverName: 'sql.js',
    exec(sql) {
      rawDb.run(sql);
      persistToDisk();
    },
    get(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      try {
        stmt.bind(Array.isArray(params) ? params : [params]);
        if (stmt.step()) {
          return stmt.getAsObject();
        }
        return undefined;
      } finally {
        stmt.free();
      }
    },
    all(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      const rows = [];
      try {
        stmt.bind(Array.isArray(params) ? params : [params]);
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        return rows;
      } finally {
        stmt.free();
      }
    },
    run(sql, params = []) {
      rawDb.run(sql, Array.isArray(params) ? params : [params]);
      const changes = rawDb.getRowsModified();
      const rowIdRes = rawDb.exec('SELECT last_insert_rowid() AS id');
      const lastInsertRowid = Number(rowIdRes?.[0]?.values?.[0]?.[0] || 0);
      persistToDisk();
      return { changes, lastInsertRowid };
    },
    transaction(fn) {
      inTransaction = true;
      rawDb.run('BEGIN');
      try {
        const result = fn();
        rawDb.run('COMMIT');
        inTransaction = false;
        persistToDisk();
        return result;
      } catch (err) {
        try {
          rawDb.run('ROLLBACK');
        } catch {
          // Abaikan error rollback sekunder
        }
        inTransaction = false;
        throw err;
      }
    },
    async backupTo(destFile) {
      persistToDisk();
      fs.copyFileSync(dbFile, destFile);
    },
    close() {
      persistToDisk();
      rawDb.close();
    },
  };
}

/**
 * Jalankan migrasi skema secara bertahap & idempoten
 */
function runMigrations(dbAdapter) {
  dbAdapter.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = dbAdapter.all('SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedSet = new Set(appliedRows.map((r) => Number(r.version)));

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.version)) continue;
    logger.info('DB', `Menjalankan migrasi database #${migration.version}: ${migration.name}`);
    dbAdapter.transaction(() => {
      dbAdapter.exec(migration.sql);
      dbAdapter.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, Date.now()]
      );
    });
  }

  // Inisialisasi default settings bila belum ada
  const now = Date.now();
  const defaults = [
    ['bot_mode', 'public'],
    ['maintenance', 'false'],
    ['maintenance_reason', 'Bot sedang dipercantik sebentar ya ♡'],
  ];
  for (const [k, v] of defaults) {
    dbAdapter.run(
      'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [k, v, now]
    );
  }
}

/**
 * Inisialisasi koneksi SQLite beserta fallback otomatis
 * @param {string} [customDbPath]
 */
async function initDatabase(customDbPath) {
  if (adapter) return adapter;

  const dbPath = customDbPath || config.paths.databaseFile;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const forceDriver = (process.env.DB_DRIVER || '').trim().toLowerCase();

  if (!forceDriver || forceDriver === 'better-sqlite3') {
    try {
      adapter = createBetterSqliteAdapter(dbPath);
      activeDriver = adapter.driverName;
    } catch (err) {
      logger.warn('DB', `better-sqlite3 gagal dimuat (${err.message}), beralih ke fallback otomatis...`);
    }
  }

  if (!adapter && (!forceDriver || forceDriver === 'node:sqlite')) {
    try {
      adapter = createNodeSqliteAdapter(dbPath);
      activeDriver = adapter.driverName;
    } catch (err) {
      logger.warn('DB', `node:sqlite tidak tersedia (${err.message}), beralih ke sql.js WASM...`);
    }
  }

  if (!adapter) {
    adapter = await createSqlJsAdapter(dbPath);
    activeDriver = adapter.driverName;
  }

  runMigrations(adapter);
  logger.info('DB', `SQLite siap digunakan (driver: ${activeDriver}, file: ${path.basename(dbPath)})`);
  return adapter;
}

function getDb() {
  if (!adapter) {
    throw new Error('Database belum diinisialisasi. Panggil await initDatabase() terlebih dahulu.');
  }
  return adapter;
}

function getDriverName() {
  return activeDriver;
}

/**
 * Hitung kebutuhan XP untuk naik ke level berikutnya
 * @param {number} level
 * @returns {number}
 */
function xpRequiredForLevel(level) {
  const lvl = Math.max(1, Number(level || 1));
  return Math.floor(100 * Math.pow(lvl, 1.35));
}

/**
 * Cek apakah JID / nomor termasuk Owner
 * @param {string} jidOrPhone
 * @returns {boolean}
 */
function isOwner(jidOrPhone = '') {
  const phone = extractPhoneFromJid(jidOrPhone) || String(jidOrPhone).replace(/[^0-9]/g, '');
  if (!phone) return false;
  return config.ownerNumbers.includes(phone);
}

/**
 * Cek status premium user (otomatis menonaktifkan yang sudah kedaluwarsa)
 * @param {string} rawJid
 * @returns {{ isPremium: boolean, tier: string|null, expiresAt: number|null, isOwner: boolean }}
 */
function getPremiumStatus(rawJid) {
  const jid = normalizeUserJid(rawJid);
  if (isOwner(jid)) {
    return { isPremium: true, tier: 'owner', expiresAt: null, isOwner: true };
  }

  const db = getDb();
  const row = db.get('SELECT * FROM premium WHERE jid = ? AND active = 1', [jid]);
  if (!row) {
    return { isPremium: false, tier: null, expiresAt: null, isOwner: false };
  }

  const now = Date.now();
  if (Number(row.expires_at) <= now) {
    db.run('UPDATE premium SET active = 0, updated_at = ? WHERE jid = ?', [now, jid]);
    return { isPremium: false, tier: null, expiresAt: null, isOwner: false };
  }

  return {
    isPremium: true,
    tier: row.tier || 'sakura',
    expiresAt: Number(row.expires_at),
    isOwner: false,
  };
}

/**
 * Pastikan data user & economy tersedia di database
 * @param {string} rawJid
 * @param {string} [pushName]
 */
function ensureUser(rawJid, pushName = '') {
  const db = getDb();
  const jid = normalizeUserJid(rawJid);
  if (!jid) return null;

  const phone = extractPhoneFromJid(jid);
  const cleanName = String(pushName || '').trim();
  const now = Date.now();

  let user = db.get('SELECT * FROM users WHERE jid = ?', [jid]);
  if (!user) {
    db.transaction(() => {
      db.run(
        `INSERT INTO users (jid, phone, name, created_at, updated_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [jid, phone, cleanName || 'Sahabat Cipi', now, now, now]
      );
      db.run(
        `INSERT OR IGNORE INTO economy (jid, balance, total_earned, updated_at)
         VALUES (?, ?, ?, ?)`,
        [jid, config.economy.startingBalance, config.economy.startingBalance, now]
      );
    });
    user = db.get('SELECT * FROM users WHERE jid = ?', [jid]);
  } else {
    const nextName = cleanName && cleanName !== user.name ? cleanName : user.name;
    db.run(
      "UPDATE users SET name = ?, phone = CASE WHEN ? != '' THEN ? ELSE phone END, last_seen = ?, updated_at = ? WHERE jid = ?",
      [nextName, phone, phone, now, now, jid]
    );
    db.run(
      `INSERT OR IGNORE INTO economy (jid, balance, total_earned, updated_at)
       VALUES (?, ?, ?, ?)`,
      [jid, config.economy.startingBalance, config.economy.startingBalance, now]
    );
    user.name = nextName;
    user.last_seen = now;
  }

  return user;
}

/**
 * Ambil profil lengkap user untuk kartu Menu & Profil
 * @param {string} rawJid
 * @param {string} [pushName]
 */
function getUserProfile(rawJid, pushName = '') {
  const db = getDb();
  const jid = normalizeUserJid(rawJid);
  const user = ensureUser(jid, pushName);
  const economy = db.get('SELECT * FROM economy WHERE jid = ?', [jid]) || {
    balance: config.economy.startingBalance,
    bank: 0,
    gems: 0,
    gacha_shards: 0,
    daily_streak: 0,
  };
  const premium = getPremiumStatus(jid);
  const mcLink = db.get(
    "SELECT * FROM links WHERE jid = ? AND status IN ('verified', 'linked')",
    [jid]
  ) || null;
  const gachaSummary = db.get(
    'SELECT COUNT(*) AS unique_count, COALESCE(SUM(count), 0) AS total_pulls FROM gacha WHERE jid = ?',
    [jid]
  ) || { unique_count: 0, total_pulls: 0 };
  const ssrCountRow = db.get(
    "SELECT COUNT(*) AS cnt FROM gacha WHERE jid = ? AND rarity = 'SSR'",
    [jid]
  ) || { cnt: 0 };
  const pet = db.get('SELECT * FROM pets WHERE jid = ?', [jid]) || null;

  const xpNeeded = xpRequiredForLevel(user.level);
  const xpProgress = Math.min(1, Math.max(0, Number(user.xp || 0) / xpNeeded));

  return {
    jid,
    phone: user.phone || extractPhoneFromJid(jid),
    name: user.name || 'Sahabat Cipi',
    bio: user.bio || 'Petualang CipiSMP ♡',
    title:
      user.title && user.title !== 'Pendatang Baru'
        ? user.title
        : premium.isOwner
        ? 'Owner CipiSMP'
        : premium.isPremium
        ? 'Sakura VIP'
        : 'Pendatang Baru',
    level: Number(user.level || 1),
    xp: Number(user.xp || 0),
    xpNeeded,
    xpProgress,
    isBanned: Boolean(user.is_banned),
    banReason: user.ban_reason || '',
    birthday: user.birthday || null,
    profileBg: user.profile_bg || 'pink-sakura',
    profileFrame: user.profile_frame || 'pastel-ribbon',
    playtimeMinutes: Number(user.playtime_minutes || 0),
    balance: Number(economy.balance || 0),
    bank: Number(economy.bank || 0),
    gems: Number(economy.gems || 0),
    gachaShards: Number(economy.gacha_shards || 0),
    dailyStreak: Number(economy.daily_streak || 0),
    premium,
    mcLink,
    gacha: {
      uniqueCount: Number(gachaSummary.unique_count || 0),
      totalPulls: Number(gachaSummary.total_pulls || 0),
      ssrCount: Number(ssrCountRow.cnt || 0),
    },
    pet,
  };
}

/**
 * Tambah XP user & cek kenaikan level otomatis
 * @param {string} rawJid
 * @param {number} amount
 */
function addXp(rawJid, amount) {
  const db = getDb();
  const jid = normalizeUserJid(rawJid);
  const user = ensureUser(jid);
  if (!user || amount <= 0) {
    return { leveledUp: false, oldLevel: user?.level || 1, newLevel: user?.level || 1, xp: user?.xp || 0 };
  }

  let level = Number(user.level || 1);
  let xp = Number(user.xp || 0) + Math.floor(amount);
  const oldLevel = level;

  while (xp >= xpRequiredForLevel(level)) {
    xp -= xpRequiredForLevel(level);
    level += 1;
  }

  db.run('UPDATE users SET xp = ?, level = ?, updated_at = ? WHERE jid = ?', [
    xp,
    level,
    Date.now(),
    jid,
  ]);

  return {
    leveledUp: level > oldLevel,
    oldLevel,
    newLevel: level,
    xp,
    xpNeeded: xpRequiredForLevel(level),
  };
}

/**
 * Pastikan data grup tercatat di tabel groups
 * @param {string} groupJid
 * @param {string} [groupName]
 */
function ensureGroup(groupJid, groupName = '') {
  if (!groupJid || !String(groupJid).endsWith('@g.us')) return null;
  const db = getDb();
  const now = Date.now();
  let group = db.get('SELECT * FROM groups WHERE jid = ?', [groupJid]);
  if (!group) {
    db.run(
      'INSERT INTO groups (jid, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [groupJid, groupName || '', now, now]
    );
    group = db.get('SELECT * FROM groups WHERE jid = ?', [groupJid]);
  } else if (groupName && groupName !== group.name) {
    db.run('UPDATE groups SET name = ?, updated_at = ? WHERE jid = ?', [groupName, now, groupJid]);
    group.name = groupName;
  }
  return group;
}

function getSetting(key, defaultValue = null) {
  const row = getDb().get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [String(key), String(value), Date.now()]
  );
}

function getTotalUsers() {
  const row = getDb().get('SELECT COUNT(*) AS total FROM users');
  return Number(row?.total || 0);
}

function getTotalGroups() {
  const row = getDb().get('SELECT COUNT(*) AS total FROM groups');
  return Number(row?.total || 0);
}

/**
 * Catat audit log ke tabel logs (tanpa menyimpan konten chat bridge pribadi)
 */
function formatAuditActor(rawActor = '') {
  const str = String(rawActor || '').trim();
  if (!str) return 'system';
  if (
    str.startsWith('panel:') ||
    str === 'system' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(str) ||
    str.includes('::')
  ) {
    return str;
  }
  return normalizeUserJid(str);
}

function addAuditLog({
  level = 'info',
  category = 'system',
  actorJid = '',
  target = '',
  action = '',
  details = {},
}) {
  try {
    getDb().run(
      `INSERT INTO logs (level, category, actor_jid, target, action, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        level,
        category,
        formatAuditActor(actorJid),
        String(target || ''),
        String(action || ''),
        JSON.stringify(details || {}),
        Date.now(),
      ]
    );
  } catch (err) {
    logger.error('DB', 'Gagal menyimpan audit log', err);
  }
}

function closeDatabase() {
  if (adapter) {
    try {
      adapter.close();
    } catch (err) {
      logger.error('DB', 'Gagal menutup koneksi database', err);
    }
    adapter = null;
    activeDriver = 'closed';
  }
}

module.exports = {
  initDatabase,
  getDb,
  getDriverName,
  closeDatabase,
  extractPhoneFromJid,
  normalizeUserJid,
  registerLidMapping,
  formatMentionTag,
  normalizeMinecraftUsername,
  xpRequiredForLevel,
  isOwner,
  getPremiumStatus,
  ensureUser,
  getUserProfile,
  addXp,
  ensureGroup,
  getSetting,
  setSetting,
  getTotalUsers,
  getTotalGroups,
  addAuditLog,
};
