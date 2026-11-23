const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '.env') });

// Pastikan seluruh proses berjalan pada zona waktu WIB (Asia/Jakarta)
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

/**
 * Normalisasi daftar nomor telepon dari string env menjadi array digit bersih
 * @param {string} raw
 * @returns {string[]}
 */
function parsePhoneList(raw = '') {
  return String(raw)
    .split(',')
    .map((item) => item.replace(/[^0-9]/g, '').trim())
    .filter(Boolean);
}

/**
 * Konversi string boolean env dengan default aman
 * @param {string|undefined} val
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBool(val, fallback = false) {
  if (val === undefined || val === null || val === '') return fallback;
  const normalized = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

const ROOT_DIR = __dirname;
const ownerNumbers = parsePhoneList(process.env.OWNER_NUMBERS || '');

const config = {
  // 1. Identitas & Tema Kawaii
  botName: process.env.BOT_NAME || 'CipiSMP Bot',
  botShortName: process.env.BOT_SHORT_NAME || 'CipiBot',
  footer: process.env.BOT_FOOTER || '✦ ᴄɪᴘɪsᴍᴘ ᴋᴀᴡᴀɪɪ ʙᴏᴛ ♡',
  prefix: process.env.PREFIX || '.',
  timezone: 'Asia/Jakarta',
  locale: 'id-ID',

  // Owner
  ownerNumbers,
  ownerName: process.env.OWNER_NAME || 'Owner CipiSMP',
  pairingNumber: (process.env.PAIRING_NUMBER || '').replace(/[^0-9]/g, ''),

  // Mode fitur utama
  useButtons: parseBool(process.env.USE_BUTTONS, true),
  dryRun: parseBool(process.env.DRY_RUN, false),
  enableOwnerEval: parseBool(process.env.ENABLE_OWNER_EVAL, false),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Tautan komunitas
  links: {
    discord: process.env.DISCORD_INVITE_URL || 'https://discord.gg/cipismp',
    waGroup: process.env.WA_GROUP_URL || 'https://chat.whatsapp.com/invitecode',
    website: process.env.WEBSITE_URL || 'https://cipismp.my.id',
  },

  // Palet warna & simbol kawaii dominan pink pastel
  theme: {
    emojis: {
      star: '✦',
      diamond: '❖',
      dot: '◦',
      heart: '♡',
      flower: '✿',
      loading: '⏳',
      success: '✅',
      error: '❌',
    },
    colors: {
      bgStart: '#FFE4EF',
      bgMid: '#FFC8DF',
      bgEnd: '#FFF3F8',
      cardGlass: 'rgba(255, 255, 255, 0.86)',
      cardGlassSoft: 'rgba(255, 245, 250, 0.78)',
      borderPink: '#FF8FB8',
      borderDeep: '#F06292',
      accentPrimary: '#FF5C97',
      accentSecondary: '#FF85B3',
      accentGold: '#FFB74D',
      textPrimary: '#4A2538',
      textSecondary: '#7D4B63',
      textMuted: '#A8768E',
      barTrack: '#FAD2E2',
      barFillStart: '#FF6FA5',
      barFillEnd: '#FF9EC4',
      rarity: {
        N: { bg: '#B0BEC5', border: '#78909C', text: '#263238', glow: '#CFD8DC' },
        R: { bg: '#81D4FA', border: '#29B6F6', text: '#01579B', glow: '#B3E5FC' },
        SR: { bg: '#CE93D8', border: '#AB47BC', text: '#4A148C', glow: '#E1BEE7' },
        SSR: { bg: '#FFD54F', border: '#FFA000', text: '#4E342E', glow: '#FFECB3' },
      },
    },
  },

  // Pengaturan Kartu Canvas
  card: {
    width: 1024,
    height: 620,
    maxDimension: 1080,
    format: 'jpeg', // 'jpeg' | 'webp'
    quality: 88,
    cacheTtlMs: 8000, // Cache kartu identik selama 8 detik
    avatarTimeoutMs: 4500,
  },

  // Pengaturan Tombol Interaktif
  buttons: {
    expireMs: 5 * 60 * 1000, // Tombol kedaluwarsa setelah 5 menit
    maxTracked: 2000,
    aiModePrivate: false,
  },

  // Pengaturan Cooldown, Rate Limit & Limit Harian
  cooldown: {
    defaultSec: Number(process.env.DEFAULT_COOLDOWN_SEC || 4),
    premiumMultiplier: 0.5, // Premium mendapat cooldown 50% lebih singkat
    rateLimitWindowMs: 10000,
    rateLimitMaxCommands: 7, // Maks 7 command per 10 detik per user
    broadcastDelayMs: 1200, // Delay aman antar pengiriman pesan massal
  },

  limits: {
    free: {
      ai: Number(process.env.FREE_AI_LIMIT || 15),
      downloader: Number(process.env.FREE_DOWNLOADER_LIMIT || 15),
    },
    premium: {
      ai: Number(process.env.PREMIUM_AI_LIMIT || 100),
      downloader: Number(process.env.PREMIUM_DOWNLOADER_LIMIT || 100),
    },
  },

  // Ekonomi, Level & Gacha (disiapkan konsisten untuk semua fase)
  economy: {
    currencyName: 'Sakura Coin',
    currencySymbol: '✿',
    startingBalance: 500,
    dailyReward: 350,
    weeklyReward: 2500,
    workMin: 120,
    workMax: 420,
    workCooldownMs: Number(process.env.WORK_COOLDOWN_MIN || 30) * 60 * 1000,
    minTransfer: 10,
    xpPerMessageMin: 6,
    xpPerMessageMax: 14,
    xpCooldownMs: 25000,
    levelUpNotify: parseBool(process.env.LEVELUP_NOTIFY, true),
    premiumBonusMultiplier: 1.25, // Bonus +25% koin/XP untuk member Sakura VIP
  },

  // Pengaturan Stiker & Proteksi Grup (Fase 2)
  sticker: {
    packName: process.env.STICKER_PACK_NAME || 'CipiSMP Kawaii Pack ✿',
    author: process.env.STICKER_AUTHOR || 'CipiSMP Bot ♡',
    maxVideoSeconds: 7,
    maxMediaBytes: 12 * 1024 * 1024, // Maks 12 MB input media
  },

  moderation: {
    spamWindowMs: 6000,
    spamMaxMessages: 10, // Maks 10 pesan non-command dalam 6 detik sebelum terdeteksi banjir
    spamDuplicateMax: 5, // Maks 5 pesan panjang identik beruntun dalam 10 detik
    warnCooldownMs: 15000,
  },

  gacha: {
    pullCost: 250,
    rates: {
      SSR: 3, // 3%
      SR: 15, // 15%
      R: 37, // 37%
      N: 45, // 45%
    },
    duplicateShards: {
      N: 5,
      R: 15,
      SR: 45,
      SSR: 120,
    },
  },

  // Minecraft & Geyser (Pemain Bedrock)
  minecraft: {
    host: process.env.MC_HOST || 'play.cipismp.my.id',
    port: Number(process.env.MC_PORT || 25565),
    bedrockPort: Number(process.env.MC_BEDROCK_PORT || 19132),
    bedrockPrefix: process.env.MC_BEDROCK_PREFIX || '.',
    // Regex console chat mendukung nama Java & Geyser Bedrock (awalan "." dan spasi)
    chatRegex:
      /\]: (?:\[[^\]]*\]\s*)*<([A-Za-z0-9_. ]{2,36})>\s+(.+)$/,
    joinRegex:
      /\]: ([A-Za-z0-9_. ]{2,36}) joined the game/,
    leaveRegex:
      /\]: ([A-Za-z0-9_. ]{2,36}) left the game/,
    verifyCodeTtlMs: 10 * 60 * 1000, // Masa berlaku kode verifikasi .link (10 menit)
    dailyRewardLimit: Number(process.env.MC_DAILY_REWARD_LIMIT || 3),
    rewards: {
      roti_kit: {
        cost: 250,
        command: 'give {player} bread 32',
        label: '32x Roti Petualang',
        description: 'Bekal kenyang menjelajah dunia CipiSMP',
      },
      iron_kit: {
        cost: 500,
        command: 'give {player} iron_ingot 16',
        label: '16x Iron Ingot',
        description: 'Bahan peralatan besi siap pakai',
      },
      xp_kit: {
        cost: 800,
        command: 'give {player} experience_bottle 24',
        label: '24x Bottle o\' Enchanting',
        description: 'Suntikan XP instan untuk enchant gear',
      },
      gapple: {
        cost: 1200,
        command: 'give {player} golden_apple 4',
        label: '4x Golden Apple',
        description: 'Apel emas penyelamat saat PvE/Boss',
      },
      diamond_kit: {
        cost: 1500,
        command: 'give {player} diamond 5',
        label: '5x Diamond',
        description: 'Permata berkilau favorit warga CipiSMP',
      },
    },
    consoleWhitelist: [
      'list',
      'tps',
      'mspt',
      'seed',
      'save-all',
      'version',
      'ver',
      'plugins',
      'pl',
      'spark tps',
      'geyser list',
      'difficulty',
      'whitelist list',
      'whitelist on',
      'whitelist off',
      'whitelist reload',
      'time query daytime',
      'time query gametime',
      'weather clear',
      'weather rain',
      'weather thunder',
    ],
    consoleParameterizedPrefixes: ['say ', 'whitelist add ', 'whitelist remove '],
  },

  // Pengaturan Jembatan Chat 2 Arah WA <-> Minecraft <-> Discord (Fase 4)
  bridge: {
    waGroupJids: String(process.env.WA_BRIDGE_GROUP_JIDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.endsWith('@g.us')),
    notifyJoinLeave: parseBool(process.env.BRIDGE_NOTIFY_JOIN_LEAVE, true),
    notifyStatus: parseBool(process.env.BRIDGE_NOTIFY_STATUS, true),
    maxMessageLength: 220,
    rateLimitWindowMs: 6000,
    rateLimitMax: 4,
    statusPollIntervalMs: 60 * 1000,
  },

  // Pterodactyl & RCON (diambil dari .env)
  pterodactyl: {
    panelUrl: (process.env.PTERO_PANEL_URL || '').replace(/\/+$/, ''),
    clientApiKey: process.env.PTERO_CLIENT_API_KEY || '',
    serverId: process.env.PTERO_SERVER_ID || '',
    timeoutMs: 10000,
  },

  rcon: {
    host: process.env.RCON_HOST || '127.0.0.1',
    port: Number(process.env.RCON_PORT || 25575),
    password: process.env.RCON_PASSWORD || '',
    timeoutMs: 8000,
  },

  // Discord (diambil dari .env)
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    bridgeChannelId: process.env.DISCORD_BRIDGE_CHANNEL_ID || '',
    statusChannelId: process.env.DISCORD_STATUS_CHANNEL_ID || '',
    ticketChannelId: process.env.DISCORD_TICKET_CHANNEL_ID || '',
    adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID || '',
  },

  // AI Provider (diambil dari .env)
  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gemini-2.0-flash',
    baseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
    timeoutMs: 25000,
  },

  // Downloader & Gambar Anime dengan Fallback Antar API (Fase 3)
  downloader: {
    cobaltApiUrl: (process.env.COBALT_API_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.DOWNLOADER_API_KEY || '',
    timeoutMs: 20000,
    maxDownloadBytes: 48 * 1024 * 1024, // Batas aman 48 MB agar RAM panel hemat
  },

  // Pengaturan Broadcast Multi-Platform (Fase 3)
  broadcast: {
    maxLength: 300, // Maksimal 300 karakter sesuai spesifikasi
    confirmTimeoutMs: 30 * 1000, // Wajib konfirmasi dalam 30 detik
    cooldownMs: 60 * 1000, // Cooldown 60 detik antar broadcast
  },

  // Backup Otomatis Database
  backup: {
    cronSchedule: '5 0 * * *', // Tiap 00:05 WIB (24 jam sekali)
    keepLast: 7, // Simpan 7 backup terakhir
  },

  // Cipi Panel (Web Control Dashboard bergaya Pterodactyl)
  panel: {
    enabled: parseBool(process.env.PANEL_ENABLED, true),
    host: process.env.PANEL_HOST || '0.0.0.0',
    port: Number(process.env.PANEL_PORT || process.env.PORT || 3000),
    username: process.env.PANEL_USERNAME || 'admin',
    password: process.env.PANEL_PASSWORD || '',
    sessionSecret: process.env.PANEL_SESSION_SECRET || '',
    sessionTtlMs: 12 * 60 * 60 * 1000, // 12 jam
  },

  // Path Direktori
  paths: (() => {
    const dbFile = process.env.DB_PATH
      ? path.resolve(ROOT_DIR, process.env.DB_PATH)
      : path.resolve(ROOT_DIR, './database/cipismp.db');
    return {
      root: ROOT_DIR,
      session: path.resolve(ROOT_DIR, process.env.SESSION_DIR || './session'),
      databaseDir: path.dirname(dbFile),
      databaseFile: dbFile,
      backupsDir: path.resolve(ROOT_DIR, process.env.BACKUP_DIR || './backups'),
      assetsDir: path.resolve(ROOT_DIR, './assets'),
      fontsDir: path.resolve(ROOT_DIR, './assets/fonts'),
      backgroundsDir: path.resolve(ROOT_DIR, './assets/backgrounds'),
      gachaDir: path.resolve(ROOT_DIR, './assets/gacha'),
      commandsDir: path.resolve(ROOT_DIR, './commands'),
      logsDir: path.resolve(ROOT_DIR, process.env.LOG_DIR || './logs'),
    };
  })(),
};

module.exports = config;
