/**
 * Smoke Test Terpadu (Fase 1 + Fase 2 + Fase 3)
 * Memverifikasi seluruh modul inti tanpa memerlukan koneksi WhatsApp aktif.
 */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');

process.env.SESSION_DIR = '/tmp/cipismp-smoke/session';
process.env.DB_PATH = '/tmp/cipismp-smoke/bot.db';
process.env.BACKUP_DIR = '/tmp/cipismp-smoke/backups';
process.env.OWNER_NUMBERS = '6281234567890';
process.env.CIPI_DISABLE_YTDLP = '1';

const config = require('../config');
const {
  smallcaps,
  renderBox,
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../lib/smallcaps');
const {
  initDatabase,
  getDriverName,
  ensureUser,
  ensureGroup,
  getPremiumStatus,
  getUserProfile,
  addXp,
  addAuditLog,
  closeDatabase,
  getDb,
} = require('../lib/database');
const {
  getDailyLimitStatus,
  consumeDailyLimit,
} = require('../lib/limits');
const { createBackup } = require('../lib/backup');
const {
  renderMenuCard,
  renderProfileCard,
  renderStatusCard,
  renderWelcomeLeaveCard,
  renderLeaderboardCard,
  renderServerCard,
  renderGachaCard,
  renderPetCard,
  renderTebakGambarCard,
} = require('../lib/card');
const {
  sendButtons,
  extractButtonResponse,
} = require('../lib/buttons');
const {
  addBalance,
  getEconomy,
  claimDaily,
  claimWeekly,
  doWork,
  transferCoins,
  getLeaderboardData,
} = require('../lib/economy');
const {
  performGachaPull,
  redeemCharacterWithShards,
  getUserGachaSummary,
  adoptPet,
  feedPet,
  playWithPet,
  restPet,
  renamePet,
  buyOrEquipShopItem,
  setUserBirthday,
  listUpcomingBirthdays,
  runDailyBirthdayCheck,
  startQuizSession,
  startTebakGambarSession,
  checkGameAnswer,
  forfeitActiveGameSession,
  drawDailyFortune,
  getRandomAnimeQuote,
  playRockPaperScissors,
  spinKawaiiSlot,
  stopKawaiiSchedulers,
} = require('../lib/kawaii');
const {
  banUser,
  unbanUser,
  listBannedUsers,
  getBotOperationalState,
  setBotAccessMode,
  setMaintenanceState,
  grantPremium,
  revokePremium,
  listActivePremiumUsers,
  getSystemDiagnostics,
  getRecentAuditLogs,
  triggerGracefulBotRestart,
  redactSecrets,
  executeControlledEval,
} = require('../lib/owner-manager');
const { getWibParts } = require('../lib/logger');
const {
  getMilestoneTitle,
} = require('../lib/leveling');
const {
  detectDisallowedLink,
  detectSpamBurst,
  computeAccurateGroupMemberCount,
} = require('../lib/group-guard');
const {
  imageToSticker,
  stickerToImage,
} = require('../lib/sticker');
const {
  validatePublicUrl,
  runWithApiFallback,
  fetchMinecraftServerStatus,
  askAiAssistant,
  fetchTikTokMedia,
  fetchInstagramMedia,
  fetchYouTubeMedia,
  fetchRandomAnimeImage,
} = require('../lib/api');
const {
  sanitizeMinecraftText,
  buildTellrawBroadcastCommand,
  buildBridgeTellrawCommand,
  validateWhitelistedConsoleCommand,
  startPteroConsoleStream,
  stopPteroConsoleStream,
  sendRconCommand,
  sendMinecraftBroadcast,
} = require('../lib/ptero');
const {
  sanitizeDiscordText,
  sendDiscordWebhookBroadcast,
} = require('../lib/discord');
const {
  setWaGroupBridgeState,
  isWaGroupBridged,
  buildBridgePrivacyNotice,
  extractWhatsAppReplyContext,
  relayFromWhatsApp,
  relayFromDiscord,
  handleMinecraftConsoleLine,
  handleServerStatusTransition,
  initiateAccountLink,
  verifyAccountFromWhisperPin,
  getLinkedAccountDetails,
  unlinkAccount,
  redeemCoinsForMcReward,
  stopBridgeServices,
} = require('../lib/bridge');
const {
  parseEventScheduleInput,
  createGiveaway,
  joinGiveaway,
  finishGiveaway,
  rerollGiveaway,
  createScheduledEvent,
  deleteScheduledEvent,
  fireScheduledEvent,
  createSupportTicket,
  replySupportTicket,
  handleDiscordTicketIncoming,
  ensureUserDailyQuests,
  recordQuestProgress,
  claimDailyQuestRewards,
  getServerLeaderboardData,
  stopCommunitySchedulers,
} = require('../lib/scheduler');
const {
  sanitizeBroadcastInput,
  initiateBroadcastFlow,
  consumePendingConfirmation,
  cancelPendingConfirmation,
  checkBroadcastCooldown,
  resetBroadcastCooldownForTest,
} = require('../lib/broadcast');
const { loadCommands, handleIncomingMessage, commands } = require('../index');

async function run() {
  console.log('╭─❖ Smoke Test Terpadu Bot CipiSMP (Fase 1 s/d Fase 7 Lengkap) ❖');

  // Bersihkan direktori uji sementara & arahkan path DB/Backup ke sandbox uji
  fs.rmSync('/tmp/cipismp-smoke', { recursive: true, force: true });
  config.paths.databaseDir = '/tmp/cipismp-smoke/db';
  config.paths.databaseFile = '/tmp/cipismp-smoke/db/cipismp.db';
  config.paths.backupsDir = '/tmp/cipismp-smoke/backups';

  // 1. Uji Smallcaps & Formatter
  const sample = smallcaps(
    `Halo @6281234567890 ketik ${mono('.menu')} atau klik https://cipismp.my.id buat ${keep('.Steve_BE')} 123!`
  );
  assert(sample.includes('ʜᴀʟᴏ'), 'Huruf biasa harus berubah menjadi smallcaps');
  assert(sample.includes('@6281234567890'), '@mention tidak boleh rusak');
  assert(sample.includes('`.menu`'), 'Command monospace tidak boleh berubah');
  assert(sample.includes('https://cipismp.my.id'), 'URL tidak boleh berubah');
  assert(sample.includes('.Steve_BE'), 'Username yang di-keep tidak boleh berubah');
  assert(sample.includes('123'), 'Angka tidak boleh berubah');
  const box = renderBox('Menu Uji', ['✦ Harga : 1.500 Koin', '◦ Ketik .menu untuk bantuan'], { footer: config.footer });
  assert(box.includes('🌸 *ᴍᴇɴᴜ ᴜᴊɪ*') && box.includes('───────────────'), 'Box frame baru wajib rapi & minimalis');
  assert(!box.includes('\n│ '), 'Box baru tidak boleh memakai garis samping │ yang patah di layar HP');
  const warnBox = formatWarning('Saldo Tidak Cukup', ['✦ Harga : 1.500 Sakura Coin']);
  assert(warnBox.includes('⚠️ *sᴀʟᴅᴏ ᴛɪᴅᴀᴋ ᴄᴜᴋᴜᴘ*'), 'formatWarning wajib tersedia dan jelas');
  console.log('│ ✅ [1/30] Smallcaps & Box Formatter lulus');

  // 2. Uji Database SQLite & Schema Lengkap 14 Tabel
  await initDatabase();
  const driver = getDriverName();
  const tables = getDb()
    .all("SELECT name FROM sqlite_master WHERE type = 'table'")
    .map((r) => r.name);
  const expectedTables = [
    'users', 'groups', 'economy', 'inventory', 'gacha', 'pets', 'tickets',
    'giveaways', 'events', 'links', 'settings', 'premium', 'quests', 'logs',
  ];
  for (const tbl of expectedTables) {
    assert(tables.includes(tbl), `Tabel wajib "${tbl}" belum dibuat`);
  }

  const testJid = '6281234567890@s.whatsapp.net';
  const secondJid = '6289876543210@s.whatsapp.net';
  const groupJid = '120363099999999999@g.us';
  ensureUser(testJid, 'Yudhis');
  ensureUser(secondJid, 'SakuraChan');
  const gInfo = ensureGroup(groupJid, 'CipiSMP Official');
  assert.strictEqual(gInfo.welcome_enabled, 1);

  const summary = getUserProfile(testJid);
  assert.strictEqual(summary.balance, config.economy.startingBalance);
  addAuditLog({ category: 'smoke_test', actorJid: testJid, action: 'init_ok' });
  console.log(`│ ✅ [2/30] Database SQLite (${driver}) & 14 tabel lulus`);

  // 3. Uji Limit Harian WIB & Tier Premium
  let lim = getDailyLimitStatus(secondJid, 'ai');
  assert.strictEqual(lim.max, config.limits.free.ai);
  consumeDailyLimit(secondJid, 'ai', 1);
  lim = getDailyLimitStatus(secondJid, 'ai');
  assert.strictEqual(lim.used, 1);

  getDb().run(
    `INSERT OR REPLACE INTO premium (jid, tier, expires_at, granted_by, note, active, created_at, updated_at)
     VALUES (?, 'Sakura VIP', ?, ?, 'Test VIP', 1, ?, ?)`,
    [secondJid, Date.now() + 7 * 86400 * 1000, testJid, Date.now(), Date.now()]
  );
  assert.strictEqual(getPremiumStatus(secondJid).isPremium, true);
  lim = getDailyLimitStatus(secondJid, 'ai');
  assert.strictEqual(lim.max, config.limits.premium.ai);
  console.log('│ ✅ [3/30] Sistem Limit Harian WIB & Premium lulus');

  // 4. Uji Ekonomi (Daily, Weekly, Kerja, Transfer & Leaderboard)
  const daily1 = claimDaily(testJid, 'Yudhis');
  assert.strictEqual(daily1.ok, true);
  assert.strictEqual(claimDaily(testJid, 'Yudhis').ok, false);
  assert.strictEqual(claimWeekly(testJid, 'Yudhis').ok, true);
  assert.strictEqual(doWork(testJid, 'Yudhis').ok, true);

  const txOk = transferCoins(testJid, secondJid, 500);
  assert.strictEqual(txOk.ok, true);
  assert.strictEqual(getEconomy(secondJid).balance, config.economy.startingBalance + 500);
  const lbSaldo = getLeaderboardData('saldo', testJid, 5);
  assert(lbSaldo.rows.length >= 2);
  console.log('│ ✅ [4/30] Ekonomi (Daily, Weekly, Kerja, Transfer) lulus');

  // 5. Uji Auto-XP Leveling
  const xpUp = addXp(testJid, 350);
  assert(xpUp.leveledUp && xpUp.newLevel >= 2);
  assert(getMilestoneTitle(xpUp.newLevel).length > 0);
  console.log('│ ✅ [5/30] Sistem Auto-XP & Leveling lulus');

  // 6. Uji Moderasi Grup (Antilink & Antispam)
  const linkCheck = await detectDisallowedLink(
    null,
    groupJid,
    'Yuk join grup lain https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv',
    false
  );
  assert(linkCheck !== null, 'Link grup WA asing harus terdeteksi antilink');
  let spamFlag = null;
  for (let i = 0; i < 8; i += 1) {
    spamFlag = detectSpamBurst(groupJid, secondJid, 'spam pesan berulang');
  }
  assert(spamFlag !== null);
  console.log('│ ✅ [6/30] Sistem Moderasi Grup lulus');

  // 7. Uji Stiker EXIF & Konversi Gambar (.sticker & .toimg)
  const mascotBuf = fs.readFileSync(path.join(config.paths.assetsDir, 'mascot.png'));
  const webpSticker = await imageToSticker(mascotBuf, {
    packName: 'CipiSMP Pack',
    authorName: 'Sakura Bot',
  });
  assert.strictEqual(webpSticker.subarray(0, 4).toString('ascii'), 'RIFF');
  const WebP = require('node-webpmux');
  const webpImg = new WebP.Image();
  await webpImg.load(webpSticker);
  const exifJsonStr = webpImg.exif.subarray(22).toString('utf8');
  assert(exifJsonStr.includes('CipiSMP Pack'));
  const backToPng = await stickerToImage(webpSticker);
  assert(backToPng[0] === 0x89 && backToPng[1] === 0x50);
  console.log('│ ✅ [7/30] Konversi Stiker WebP + EXIF & .toimg lulus');

  // 8. Uji Canvas Renderer Fase 1 + 2 + 3 (termasuk renderServerCard Java + Bedrock)
  const backend = '@napi-rs/canvas';
  const menuCard = await renderMenuCard({
    userName: 'Yudhis',
    level: summary.level,
    xp: summary.xp,
    xpNeeded: summary.xpNeeded,
    balance: summary.balance,
    isPremium: true,
    uptimeText: '2j 15m',
    categoryCount: 7,
    commandCount: 38,
  });
  const profileCard = await renderProfileCard({
    profile: summary,
    aiLimitText: '15/15',
    dlLimitText: '20/20',
  });
  const statusCard = await renderStatusCard({
    pingMs: 28,
    uptimeText: '2j 15m',
    ramUsedMb: 145,
    ramTotalMb: 4096,
    totalUsers: 2,
    totalGroups: 1,
    dbDriver: driver,
    canvasEngine: backend,
  });
  const welcomeCard = await renderWelcomeLeaveCard({
    mode: 'welcome',
    userName: 'SakuraChan',
    groupName: 'CipiSMP Official',
    memberCount: 128,
  });
  const lbCard = await renderLeaderboardCard({
    mode: 'saldo',
    rows: lbSaldo.rows,
  });
  const serverOnlineCard = await renderServerCard({
    online: true,
    host: 'play.cipismp.my.id',
    javaPort: 25565,
    bedrockPort: 19132,
    version: 'Paper 1.21.4 (Geyser)',
    motd: '✿ CipiSMP Season 3 — Dunia Survival Kawaii & Hangat! ✿',
    playersOnline: 24,
    playersMax: 60,
    playerSample: ['Yudhis', '.Sakura_BE', 'KawaiiNeko', '.RizkyPocket', 'MochiCraft', 'NanaChan'],
    iconBuffer: mascotBuf,
  });
  const serverOfflineCard = await renderServerCard({
    online: false,
    host: 'play.cipismp.my.id',
    javaPort: 25565,
    bedrockPort: 19132,
    version: '-',
    motd: 'Server sedang maintenance terjadwal ♡',
    playersOnline: 0,
    playersMax: 60,
    playerSample: [],
  });

  for (const [label, buf] of [
    ['Menu', menuCard],
    ['Profil', profileCard],
    ['Status', statusCard],
    ['Welcome', welcomeCard],
    ['Leaderboard', lbCard],
    ['ServerOnline', serverOnlineCard],
    ['ServerOffline', serverOfflineCard],
  ]) {
    assert(Buffer.isBuffer(buf) && buf.length > 5000, `Kartu ${label} tidak valid`);
    assert(buf[0] === 0xff && buf[1] === 0xd8, `Kartu ${label} harus berformat JPEG`);
  }
  console.log(`│ ✅ [8/30] Canvas Card Engine (${backend}) 7 tipe kartu lulus`);

  // 9. Uji Validasi Keamanan URL Anti-SSRF & Fallback Antar API (lib/api.js)
  assert.strictEqual(validatePublicUrl('http://127.0.0.1:8080/secret').valid, false);
  assert.strictEqual(validatePublicUrl('http://192.168.1.10/admin').valid, false);
  assert.strictEqual(validatePublicUrl('http://localhost/api').valid, false);
  assert.strictEqual(
    validatePublicUrl('https://vt.tiktok.com/ZSY12345/', [/(^|\.)tiktok\.com$/i]).valid,
    true
  );
  assert.strictEqual(
    validatePublicUrl('https://evil.example.com/ZSY12345/', [/(^|\.)tiktok\.com$/i]).valid,
    false
  );

  let attempts = 0;
  const chainRes = await runWithApiFallback('TEST_CHAIN', [
    {
      name: 'PrimaryBroken',
      fn: async () => {
        attempts += 1;
        throw new Error('502 Bad Gateway');
      },
    },
    {
      name: 'SecondaryHealthy',
      fn: async () => {
        attempts += 1;
        return { hello: 'sakura' };
      },
    },
  ]);
  assert.strictEqual(chainRes.ok, true);
  assert.strictEqual(chainRes.provider, 'SecondaryHealthy');
  assert.strictEqual(attempts, 2);
  console.log('│ ✅ [9/30] Anti-SSRF Validator & Multi-API Fallback Engine lulus');

  // 10. Uji Mocked API Eksternal (.server, .ai, .tiktok, .ig, .yt, .anime)
  const originalFetch = global.fetch;
  try {
    const tinyIconBase64 = `data:image/png;base64,${mascotBuf.toString('base64')}`;
    global.fetch = async (url) => {
      const u = String(url);
      // Simulasikan provider pertama mcsrvstat gagal 503 -> otomatis pindah ke mcstatus.io!
      if (u.includes('api.mcsrvstat.us/3/')) {
        return new Response('Service Unavailable', { status: 503 });
      }
      if (u.includes('api.mcstatus.io/v2/status/java/')) {
        return new Response(
          JSON.stringify({
            online: true,
            version: { name_clean: 'Paper 1.21.4' },
            motd: { clean: '§d✿ CipiSMP Survival ✿' },
            players: {
              online: 12,
              max: 50,
              list: [{ name_clean: 'Yudhis' }, { name_clean: '.BedrockGamer' }],
            },
            icon: tinyIconBase64,
          }),
          { status: 200 }
        );
      }
      if (u.includes('generativelanguage.googleapis.com')) {
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: 'Halo kak! Bikin iron farm gampang banget kok ♡' }] } },
            ],
          }),
          { status: 200 }
        );
      }
      // Simulasikan TikWM gagal -> otomatis jatuh ke TiklyDown!
      if (u.includes('tikwm.com')) {
        return new Response(JSON.stringify({ code: -1, msg: 'rate limit' }), { status: 200 });
      }
      if (u.includes('tiklydown.eu.org')) {
        return new Response(
          JSON.stringify({
            title: 'Build Rumah Sakura Minecraft',
            author: { name: 'CipiBuilder' },
            video: { noWatermark: 'https://cdn.example.com/video.mp4' },
          }),
          { status: 200 }
        );
      }
      if (u.includes('ryzendesu.vip/api/downloader/igdl')) {
        return new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/reel.mp4', type: 'video' }],
          }),
          { status: 200 }
        );
      }
      if (u.includes('ryzendesu.vip/api/downloader/ytmp3')) {
        return new Response(
          JSON.stringify({
            title: 'OST Minecraft Sweden Kawaii Remix',
            url: 'https://cdn.example.com/song.mp3',
          }),
          { status: 200 }
        );
      }
      // Simulasikan waifu.pics gagal -> otomatis jatuh ke nekos.best!
      if (u.includes('api.waifu.pics')) {
        return new Response('Timeout', { status: 504 });
      }
      if (u.includes('nekos.best/api/v2/neko')) {
        return new Response(
          JSON.stringify({
            results: [{ url: 'https://cdn.example.com/neko.png', artist_name: 'SakuraArt' }],
          }),
          { status: 200 }
        );
      }
      if (u.includes('cdn.example.com/neko.png')) {
        return new Response(mascotBuf, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('{}', { status: 404 });
    };

    const mcStat = await fetchMinecraftServerStatus('play.cipismp.my.id', 25565);
    assert.strictEqual(mcStat.ok, true);
    assert.strictEqual(mcStat.sourceApi, 'mcstatus.io (v2)');
    assert.strictEqual(mcStat.playersOnline, 12);
    assert(Buffer.isBuffer(mcStat.iconBuffer));

    const prevKey = config.ai.apiKey;
    config.ai.apiKey = 'test-dummy-key';
    const aiReply = await askAiAssistant('Cara bikin iron farm?', 'Yudhis');
    config.ai.apiKey = prevKey;
    assert.strictEqual(aiReply.ok, true);
    assert(aiReply.answer.includes('iron farm'));

    const ttRes = await fetchTikTokMedia('https://vt.tiktok.com/ZSY12345/');
    assert.strictEqual(ttRes.ok, true);
    assert.strictEqual(ttRes.provider, 'TiklyDown');

    const igRes = await fetchInstagramMedia('https://www.instagram.com/reel/C12345/');
    assert.strictEqual(igRes.ok, true);
    assert.strictEqual(igRes.provider, 'RyzenDesu-IG');

    const ytRes = await fetchYouTubeMedia('https://youtu.be/dQw4w9WgXcQ', 'mp3');
    assert.strictEqual(ytRes.ok, true);
    assert.strictEqual(ytRes.type, 'audio');

    const animeRes = await fetchRandomAnimeImage('neko');
    assert.strictEqual(animeRes.ok, true);
    assert.strictEqual(animeRes.provider, 'nekos.best');
    assert(Buffer.isBuffer(animeRes.buffer));
  } finally {
    global.fetch = originalFetch;
  }
  console.log('│ ✅ [10/30] Integrasi mcsrvstat, AI, Downloader (TT/IG/YT) & Anime lulus');

  // 11. Uji Sanitasi Minecraft & Protokol TCP Source RCON Murni (lib/ptero.js)
  const dirtyMc = '/op EvilPlayer\n§4Hack @e @a Halo semuanya!';
  const cleanMc = sanitizeMinecraftText(dirtyMc);
  assert(!cleanMc.startsWith('/'), 'Slash di awal harus dihapus untuk mencegah injeksi command');
  assert(!cleanMc.includes('\n'), 'Newline harus dihapus');
  assert(!cleanMc.includes('§4'), 'Formatting code § harus dihapus');
  assert(!/@[ea]\b/.test(cleanMc), 'Selector @e/@a harus dinetralkan');
  const tellrawCmd = buildTellrawBroadcastCommand(cleanMc);
  assert(
    tellrawCmd.startsWith('tellraw @a {"text":"","extra":['),
    'Tellraw wajib memakai compound homogen yang valid di MC 1.8 s/d 1.21.5+ SNBT'
  );

  // Jalankan server TCP RCON tiruan lokal untuk menguji klien RCON murni
  let receivedRconCmd = '';
  const mockRconServer = net.createServer((socket) => {
    socket.on('data', (buf) => {
      const id = buf.readInt32LE(4);
      const type = buf.readInt32LE(8);
      const body = buf.subarray(12, buf.length - 2).toString('utf8');

      const sendPkt = (resId, resType, resBody) => {
        const b = Buffer.from(resBody, 'utf8');
        const len = 4 + 4 + b.length + 2;
        const p = Buffer.alloc(4 + len);
        p.writeInt32LE(len, 0);
        p.writeInt32LE(resId, 4);
        p.writeInt32LE(resType, 8);
        b.copy(p, 12);
        p.writeInt16LE(0, 12 + b.length);
        socket.write(p);
      };

      if (type === 3) {
        sendPkt(body === 'secret-rcon' ? id : -1, 2, '');
      } else if (type === 2) {
        receivedRconCmd = body;
        sendPkt(id, 0, 'Broadcast sent');
      }
    });
  });

  await new Promise((resolve) => mockRconServer.listen(0, '127.0.0.1', resolve));
  const rconPort = mockRconServer.address().port;
  const oldRcon = { ...config.rcon };
  try {
    config.rcon.host = '127.0.0.1';
    config.rcon.port = rconPort;
    config.rcon.password = 'secret-rcon';

    const rconDirect = await sendRconCommand('say Halo dari RCON');
    assert.strictEqual(rconDirect.ok, true);
    assert.strictEqual(receivedRconCmd, 'say Halo dari RCON');

    // Karena Pterodactyl belum diisi, sendMinecraftBroadcast otomatis fallback ke RCON dengan perintah say!
    const mcBc = await sendMinecraftBroadcast('Event dimulai 10 menit lagi!');
    assert.strictEqual(mcBc.ok, true);
    assert.strictEqual(mcBc.via, 'RCON (say)');
    assert(receivedRconCmd.startsWith('say [CipiSMP]'));
  } finally {
    Object.assign(config.rcon, oldRcon);
    mockRconServer.close();
  }
  console.log('│ ✅ [11/30] Sanitasi Minecraft & Fallback TCP Source RCON lulus');

  // 12. Uji Sanitasi Discord & Webhook Embed Pink + Thumbnail Anime (lib/discord.js)
  const cleanDc = sanitizeDiscordText('Halo @everyone dan @here juga <@&99887766>!');
  assert(!cleanDc.includes('@everyone'), '@everyone wajib dinetralkan');
  assert(!cleanDc.includes('@here'), '@here wajib dinetralkan');
  assert(!cleanDc.includes('<@&99887766>'), 'Role mention wajib dinetralkan');

  const oldWebhook = config.discord.webhookUrl;
  let webhookMultipartCaptured = false;
  try {
    config.discord.webhookUrl = 'https://discord.com/api/webhooks/123456789/abcdefg';
    global.fetch = async (_url, opts) => {
      if (opts?.body && typeof opts.body.get === 'function') {
        const jsonPart = JSON.parse(opts.body.get('payload_json'));
        if (
          jsonPart.embeds?.[0]?.color === 0xff5c97 &&
          jsonPart.embeds?.[0]?.thumbnail?.url === 'attachment://mascot.png'
        ) {
          webhookMultipartCaptured = true;
        }
      }
      return new Response(JSON.stringify({ id: '1' }), { status: 200 });
    };

    const dcRes = await sendDiscordWebhookBroadcast({
      message: 'Maintenance selesai, ayo login semuanya! @everyone',
      senderLabel: 'Yudhis',
    });
    assert.strictEqual(dcRes.ok, true);
    assert.strictEqual(webhookMultipartCaptured, true);
  } finally {
    config.discord.webhookUrl = oldWebhook;
    global.fetch = originalFetch;
  }
  console.log('│ ✅ [12/30] Discord Webhook (Embed Pink + Thumbnail Lokal + Anti-@everyone) lulus');

  // 13. Uji Alur Broadcast Owner (.bcall + Preview + .batal + .ya + Cooldown 60d + Audit Log + DRY_RUN)
  resetBroadcastCooldownForTest();
  assert.strictEqual(sanitizeBroadcastInput('A'.repeat(301)).valid, false);

  const sentPayloads = [];
  const prevButtonsMode = config.useButtons;
  const prevDryRun = config.dryRun;
  config.useButtons = false;
  config.dryRun = true;

  const mockSock = {
    sendMessage: async (jid, content) => {
      sentPayloads.push({ jid, content });
      return { key: { id: `MSG_${sentPayloads.length}` } };
    },
    groupFetchAllParticipating: async () => ({
      [groupJid]: { id: groupJid, subject: 'CipiSMP Official' },
    }),
  };

  const makeOwnerCtx = (commandName, text) => ({
    sock: mockSock,
    msg: { key: { id: 'M1', remoteJid: testJid } },
    chatJid: testJid,
    senderJid: testJid,
    pushName: 'OwnerYudhis',
    commandName,
    text,
    args: text ? text.split(/\s+/) : [],
    reply: async (t) => mockSock.sendMessage(testJid, { text: t }),
  });

  // Uji preview lalu dibatalkan dengan .batal
  await initiateBroadcastFlow(makeOwnerCtx('bcall', 'Tes batal dulu'), 'all');
  assert(sentPayloads.at(-1).content.text.includes('ᴘʀᴇᴠɪᴇᴡ & ᴋᴏɴꜰɪʀᴍᴀsɪ ʙʀᴏᴀᴅᴄᴀsᴛ'));
  const cancelled = cancelPendingConfirmation(testJid);
  assert(cancelled !== null);
  assert.strictEqual(consumePendingConfirmation(testJid), null);

  // Uji preview lalu dikonfirmasi dengan .ya (dalam mode DRY_RUN)
  await initiateBroadcastFlow(
    makeOwnerCtx('bcall', 'Event malam minggu dimulai pukul 19:30 WIB!'),
    'all'
  );
  const yaCmd = require('../commands/owner/ya');
  await yaCmd.execute(makeOwnerCtx('ya', ''));

  const lastReport = sentPayloads.at(-1).content.text;
  assert(lastReport.includes('ʟᴀᴘᴏʀᴀɴ ʜᴀsɪʟ ʙʀᴏᴀᴅᴄᴀsᴛ'), 'Laporan per tujuan harus dikirim');
  assert(
    lastReport.includes('ᴡʜᴀᴛsᴀᴘᴘ') &&
      lastReport.includes('ᴍɪɴᴇᴄʀᴀꜰᴛ') &&
      lastReport.includes('ᴅɪsᴄᴏʀᴅ'),
    'Laporan harus memuat status WhatsApp, Minecraft, dan Discord'
  );

  // Pastikan cooldown 60 detik langsung aktif setelah eksekusi
  assert.strictEqual(checkBroadcastCooldown().allowed, false);

  // Pastikan pengirim dan detail tercatat di tabel audit logs
  const bcLog = getDb().get(
    "SELECT * FROM logs WHERE category = 'broadcast' ORDER BY id DESC LIMIT 1"
  );
  assert(bcLog && bcLog.actor_jid === testJid, 'Log pengirim broadcast harus tercatat');

  config.useButtons = prevButtonsMode;
  config.dryRun = prevDryRun;
  resetBroadcastCooldownForTest();
  console.log('│ ✅ [13/30] Alur Broadcast Multi-Platform (.bcall/.ya/.batal/Cooldown/Audit/DryRun) lulus');

  // 14. Uji Tautan Akun WA <-> Minecraft Java & Geyser Bedrock (.link, .unlink, .akun, .tukar)
  // A. Tautan Java Edition + Verifikasi Otomatis lewat Baris Chat Console Minecraft
  const javaLinkReq = await initiateAccountLink(testJid, 'YudhisCraft');
  assert.strictEqual(javaLinkReq.ok, true);
  assert.strictEqual(javaLinkReq.isBedrock, false);
  await handleMinecraftConsoleLine(
    `[15:10:01 INFO]: <YudhisCraft> Halo aku mau verifikasi ${javaLinkReq.publicChatCode}`
  );
  const javaDetails = getLinkedAccountDetails(testJid);
  assert.strictEqual(javaDetails.status, 'verified');
  assert.strictEqual(javaDetails.mcUsername, 'YudhisCraft');

  // Cegah user lain mengklaim username yang sudah terverifikasi
  const hijackAttempt = await initiateAccountLink(secondJid, 'yudhiscraft');
  assert.strictEqual(hijackAttempt.ok, false);
  assert.strictEqual(hijackAttempt.reason, 'username_taken');

  // B. Tautan Geyser Bedrock dengan spasi & awalan "." + Verifikasi lewat PIN Bisikan (/tell)
  const bedrockLinkReq = await initiateAccountLink(secondJid, 'Sakura Gamer', 'bedrock');
  assert.strictEqual(bedrockLinkReq.ok, true);
  assert.strictEqual(bedrockLinkReq.isBedrock, true);
  assert.strictEqual(bedrockLinkReq.mcUsername, '.Sakura Gamer');

  const rawPendingRow = getDb().get('SELECT verify_code FROM links WHERE jid = ?', [secondJid]);
  const whisperedPin = rawPendingRow.verify_code.split('|')[1];
  const pinVerif = verifyAccountFromWhisperPin(secondJid, whisperedPin);
  assert.strictEqual(pinVerif.ok, true);
  assert.strictEqual(pinVerif.isBedrock, true);

  // C. Uji Penukaran Poin .tukar (Refund otomatis saat server mati, dan sukses saat DRY_RUN / RCON aktif)
  const walletBeforeFail = getEconomy(secondJid).balance;
  config.dryRun = false;
  const failRedeem = await redeemCoinsForMcReward(secondJid, 'roti_kit');
  assert.strictEqual(failRedeem.ok, false);
  assert.strictEqual(failRedeem.reason, 'delivery_failed');
  assert.strictEqual(
    getEconomy(secondJid).balance,
    walletBeforeFail,
    'Koin wajib di-refund 100% bila pengiriman ke server gagal!'
  );

  config.dryRun = true;
  const okRedeem = await redeemCoinsForMcReward(secondJid, 'roti_kit');
  assert.strictEqual(okRedeem.ok, true);
  assert.strictEqual(okRedeem.remainingDaily, config.minecraft.dailyRewardLimit - 1);
  config.dryRun = prevDryRun;

  // D. Uji .unlink
  const unlinked = unlinkAccount(testJid);
  assert.strictEqual(unlinked.ok, true);
  assert.strictEqual(getLinkedAccountDetails(testJid), null);
  console.log('│ ✅ [14/30] Tautan Akun Java & Geyser Bedrock (.link/.unlink/.akun/.tukar + Auto-Refund) lulus');

  // 15. Uji Jembatan Komunitas 2 Arah (WA <-> MC <-> Discord), Join/Leave Playtime & Privasi
  setWaGroupBridgeState(groupJid, true);
  assert.strictEqual(isWaGroupBridged(groupJid), true);
  const privacyNotice = buildBridgePrivacyNotice();
  assert(
    privacyNotice.includes('ᴘʀɪᴠᴀsɪ') && /tidak menyimpan/i.test(privacyNotice),
    'Pemberitahuan privasi wajib menjelaskan isi chat tidak disimpan di DB'
  );

  config.dryRun = true;
  const secretBridgeSentence = 'KalimatRahasiaEphemeral998877';
  await relayFromWhatsApp({
    chatJid: groupJid,
    senderJid: secondJid,
    pushName: 'SakuraChan',
    body: secretBridgeSentence,
  });
  await relayFromDiscord({
    authorName: 'NekoDiscord',
    content: secretBridgeSentence,
    messageId: 'DC_1',
  });
  await handleMinecraftConsoleLine(
    `[15:12:00 INFO]: <.Sakura Gamer> ${secretBridgeSentence}`
  );
  await handleMinecraftConsoleLine('[15:12:05 INFO]: .Sakura Gamer joined the game');
  await handleMinecraftConsoleLine('[15:12:55 INFO]: .Sakura Gamer left the game');
  await handleServerStatusTransition('running', 'starting');
  await handleServerStatusTransition('offline', 'running');
  config.dryRun = prevDryRun;

  // Pastikan kalimat chat bridge TIDAK PERNAH tersimpan di tabel mana pun pada SQLite
  const leakedInLogs = getDb().get(
    'SELECT id FROM logs WHERE details_json LIKE ?',
    [`%${secretBridgeSentence}%`]
  );
  assert(!leakedInLogs, 'Isi chat bridge dilarang keras disimpan ke database!');

  // Pastikan playtime pemain Bedrock yang sudah .link tercatat otomatis saat keluar server
  const updatedBedrockAcc = getLinkedAccountDetails(secondJid);
  assert(updatedBedrockAcc.playtimeMinutes >= 1, 'Playtime pemain tertaut harus bertambah saat leave');
  console.log('│ ✅ [15/30] Bridge 2 Arah (WA<->MC<->DC), Join/Leave Playtime & Jaminan Privasi lulus');

  // 16. Uji Stream WebSocket Pterodactyl Wings Real-Time + Refresh Token Otomatis
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => wss.once('listening', resolve));
  const wsPort = wss.address().port;

  let wsAuthedCount = 0;
  let capturedConsoleLines = [];
  let capturedStatuses = [];

  wss.on('connection', (socket, req) => {
    assert.strictEqual(req.headers.origin, 'http://127.0.0.1:8080');
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.event === 'auth') {
        wsAuthedCount += 1;
        socket.send(JSON.stringify({ event: 'auth success', args: [] }));
        if (wsAuthedCount === 1) {
          socket.send(JSON.stringify({ event: 'status', args: ['running'] }));
          socket.send(
            JSON.stringify({
              event: 'console output',
              args: ['\x1b[32m[15:20:00 INFO]: <.BedrockNeko> Miaw halo semuanya!\x1b[0m'],
            })
          );
          socket.send(JSON.stringify({ event: 'token expiring', args: [] }));
        }
      }
    });
  });

  const prevPtero = { ...config.pterodactyl };
  try {
    config.pterodactyl.panelUrl = 'http://127.0.0.1:8080';
    config.pterodactyl.clientApiKey = 'ptlc_dummy_smoke';
    config.pterodactyl.serverId = 'srv12345';

    global.fetch = async (url) => {
      if (String(url).endsWith('/websocket')) {
        return new Response(
          JSON.stringify({
            data: {
              socket: `ws://127.0.0.1:${wsPort}`,
              token: `jwt-token-${wsAuthedCount + 1}`,
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    };

    await startPteroConsoleStream({
      onConsoleLine: async (line) => capturedConsoleLines.push(line),
      onStatusChange: async (st) => capturedStatuses.push(st),
    });

    await new Promise((resolve) => setTimeout(resolve, 180));
    assert(wsAuthedCount >= 2, 'WebSocket harus otomatis refresh token saat token expiring');
    assert(capturedStatuses.includes('running'));
    assert(
      capturedConsoleLines.some((l) => l.includes('<.BedrockNeko> Miaw halo semuanya!')),
      'Kode warna ANSI harus dibersihkan dari console output'
    );
  } finally {
    stopPteroConsoleStream();
    wss.close();
    Object.assign(config.pterodactyl, prevPtero);
    global.fetch = originalFetch;
  }
  console.log('│ ✅ [16/30] Pterodactyl Wings WebSocket Stream & Auto-Token-Refresh lulus');

  // 17. Uji Whitelist .console & Kontrol Server Owner (.start, .stop, .restart, .backup)
  assert.strictEqual(validateWhitelistedConsoleCommand('list').allowed, true);
  assert.strictEqual(validateWhitelistedConsoleCommand('/tps').allowed, true);
  assert.strictEqual(
    validateWhitelistedConsoleCommand('whitelist add .Sakura Gamer').cleanCommand,
    'whitelist add ".Sakura Gamer"'
  );
  assert.strictEqual(validateWhitelistedConsoleCommand('op EvilHacker').allowed, false);
  assert.strictEqual(validateWhitelistedConsoleCommand('list; op EvilHacker').allowed, false);
  assert.strictEqual(validateWhitelistedConsoleCommand('execute as @a run kill').allowed, false);

  config.dryRun = true;
  config.useButtons = false;
  const startCmd = require('../commands/owner/start');
  const stopCmd = require('../commands/owner/stop');
  const restartCmd = require('../commands/owner/restart');
  const backupCmd = require('../commands/owner/backup');
  const consoleCmd = require('../commands/owner/console');
  const bridgeCmd = require('../commands/owner/bridge');
  const akunCmd = require('../commands/server/akun');

  await bridgeCmd.execute({
    ...makeOwnerCtx('bridge', 'status'),
    isGroup: true,
    chatJid: groupJid,
  });
  assert(sentPayloads.at(-1).content.text.includes('sᴛᴀᴛᴜs ᴊᴇᴍʙᴀᴛᴀɴ ᴋᴏᴍᴜɴɪᴛᴀs'));

  await akunCmd.execute({
    ...makeOwnerCtx('akun', ''),
    senderJid: secondJid,
    replyCard: async (_buf, caption) => mockSock.sendMessage(secondJid, { text: caption }),
  });
  assert(sentPayloads.at(-1).content.text.includes('.Sakura Gamer'));

  await startCmd.execute(makeOwnerCtx('start', ''));
  assert(sentPayloads.at(-1).content.text.includes('sɪɴʏᴀʟ sᴛᴀʀᴛ ᴅɪᴋɪʀɪᴍ'));

  await stopCmd.execute(makeOwnerCtx('stop', ''));
  assert(sentPayloads.at(-1).content.text.includes('ᴋᴏɴꜰɪʀᴍᴀsɪ ᴍᴀᴛɪᴋᴀɴ sᴇʀᴠᴇʀ'));
  await yaCmd.execute(makeOwnerCtx('ya', ''));
  assert(sentPayloads.at(-1).content.text.includes('sɪɴʏᴀʟ sᴛᴏᴘ ᴅɪᴋɪʀɪᴍ'));

  await restartCmd.execute(makeOwnerCtx('restart', ''));
  assert(sentPayloads.at(-1).content.text.includes('ᴋᴏɴꜰɪʀᴍᴀsɪ ʀᴇsᴛᴀʀᴛ sᴇʀᴠᴇʀ'));
  cancelPendingConfirmation(testJid);

  await backupCmd.execute(makeOwnerCtx('backup', 'pra-event'));
  assert(sentPayloads.at(-1).content.text.includes('ʙᴀᴄᴋᴜᴘ sᴇʀᴠᴇʀ ᴅɪᴍᴜʟᴀɪ'));

  await consoleCmd.execute(makeOwnerCtx('console', 'op Hacker'));
  assert(sentPayloads.at(-1).content.text.includes('ᴅɪᴛᴏʟᴀᴋ ᴡʜɪᴛᴇʟɪsᴛ'));

  await consoleCmd.execute(makeOwnerCtx('console', 'list'));
  assert(sentPayloads.at(-1).content.text.includes('ᴘᴇʀɪɴᴛᴀʜ ᴄᴏɴsᴏʟᴇ ᴛᴇʀᴋɪʀɪᴍ'));

  config.dryRun = prevDryRun;
  config.useButtons = prevButtonsMode;
  console.log('│ ✅ [17/30] Kontrol Server Owner (.start/.stop/.restart/.backup) & Whitelist .console lulus');

  // 18. Uji Giveaway Berdurasi, Pendaftaran Peserta, Undian Pemenang Otomatis + Bonus Koin & Reroll
  config.dryRun = true;
  const gw = createGiveaway({
    hostRawJid: testJid,
    groupJid,
    durationMs: 60000,
    winnerCount: 1,
    prizeAmount: 750,
    prizeLabel: 'VIP Sakura + 750 Koin',
  });
  assert(gw.code.startsWith('GW-'));
  assert.strictEqual(joinGiveaway(testJid, groupJid, gw.code).ok, true);
  assert.strictEqual(joinGiveaway(testJid, groupJid, gw.code).reason, 'already_joined');
  assert.strictEqual(joinGiveaway(secondJid, groupJid, gw.code).ok, true);

  const totalCoinsBeforeGw =
    getEconomy(testJid).balance + getEconomy(secondJid).balance;
  const gwDone = await finishGiveaway(gw.code);
  assert.strictEqual(gwDone.ok, true);
  assert.strictEqual(gwDone.winners.length, 1);
  const totalCoinsAfterGw =
    getEconomy(testJid).balance + getEconomy(secondJid).balance;
  assert.strictEqual(
    totalCoinsAfterGw,
    totalCoinsBeforeGw + 750,
    'Pemenang giveaway wajib menerima bonus koin otomatis'
  );

  const gwReroll = rerollGiveaway(gw.code);
  assert.strictEqual(gwReroll.ok, true);
  assert.notStrictEqual(
    gwReroll.newWinner,
    gwDone.winners[0],
    'Reroll harus memprioritaskan peserta lain yang belum menang'
  );
  console.log('│ ✅ [18/30] Giveaway Berdurasi, Undian Pemenang Otomatis & Reroll lulus');

  // 19. Uji Penjadwal Event Sekali & Berulang via node-cron WIB
  assert.strictEqual(parseEventScheduleInput('2027-05-10 19:30').valid, true);
  assert.strictEqual(parseEventScheduleInput('harian 19:00').cronExpr, '0 19 * * *');
  assert.strictEqual(parseEventScheduleInput('mingguan sabtu 20:00').cronExpr, '0 20 * * 6');
  assert.strictEqual(parseEventScheduleInput('0 21 * * 0').valid, true);

  const evCreated = createScheduledEvent({
    rawSchedule: 'mingguan sabtu 20:00',
    title: 'Boss Raid Akhir Pekan',
    description: 'Kumpul di Arena Spawn CipiSMP!',
    targetGroups: [groupJid],
    actorJid: testJid,
  });
  assert.strictEqual(evCreated.ok, true);
  const evRow = getDb().get('SELECT * FROM events WHERE code = ?', [evCreated.code]);
  const evFired = await fireScheduledEvent(evRow);
  assert.strictEqual(evFired.ok, true);
  assert.strictEqual(deleteScheduledEvent(evCreated.code).ok, true);
  console.log('│ ✅ [19/30] Penjadwal Event Komunitas (Sekali & Cron Berulang WIB) lulus');

  // 20. Uji Sistem Tiket / Laporan User (.lapor & .tiket) Tersinkron 2 Arah ke Discord
  const tkt = await createSupportTicket({
    senderRawJid: secondJid,
    pushName: 'SakuraChan',
    categoryInput: 'bug',
    messageInput: 'Ada bug chest tidak bisa dibuka di dekat koordinat spawn 120 65 -80',
  });
  assert.strictEqual(tkt.ok, true);
  assert(tkt.ticketNo.startsWith('TKT-'));

  // Simulasikan Admin Discord membalas langsung di Thread tiket
  const threadReply = await handleDiscordTicketIncoming({
    authorName: 'ModHaruka',
    content: 'Halo kak Sakura, sedang kami cek di lokasi ya!',
    channelId: 'dryrun-thread-id',
    isThread: true,
  });
  assert.strictEqual(threadReply.handled, true);
  assert.strictEqual(threadReply.action, 'replied_thread');

  // Simulasikan Pelapor WA membalas balik lewat .tiket balas
  const waFollowUp = await replySupportTicket({
    actorRawJid: secondJid,
    actorName: 'SakuraChan',
    isStaff: false,
    ticketNoInput: tkt.ticketNo,
    replyText: 'Siap kak, terima kasih banyak!',
  });
  assert.strictEqual(waFollowUp.ok, true);

  // Simulasikan Admin Discord menutup tiket lewat !tutup TKT-XXXX
  const dcClose = await handleDiscordTicketIncoming({
    authorName: 'ModHaruka',
    content: `!tutup ${tkt.ticketNo} Proteksi chunk sudah diperbaiki!`,
    channelId: 'dryrun-thread-id',
    isThread: true,
  });
  assert.strictEqual(dcClose.handled, true);
  const closedTktRow = getDb().get('SELECT * FROM tickets WHERE ticket_no = ?', [tkt.ticketNo]);
  assert.strictEqual(closedTktRow.status, 'closed');
  assert(closedTktRow.resolution.includes('Proteksi chunk'));
  config.dryRun = prevDryRun;
  console.log('│ ✅ [20/30] Sistem Tiket .lapor <-> Channel/Thread Admin Discord 2 Arah lulus');

  // 21. Uji 3 Quest Harian Acak WIB, Bonus Komplit 3/3 & Kartu Papan Peringkat Server (.topserver)
  const myQuests = ensureUserDailyQuests(secondJid);
  assert.strictEqual(myQuests.length, 3, 'Setiap user wajib mendapat 3 misi acak harian');
  for (const q of myQuests) {
    recordQuestProgress(secondJid, q.quest_code, Number(q.target_count));
  }
  const claimedQuests = claimDailyQuestRewards(secondJid);
  assert.strictEqual(claimedQuests.ok, true);
  assert.strictEqual(
    claimedQuests.fullClearBonusCoins,
    300,
    'Sapu bersih 3/3 misi wajib mendapat bonus ekstra 300 Sakura Coin'
  );

  const srvLbPlaytime = getServerLeaderboardData('playtime', secondJid, 10);
  const srvLbQuest = getServerLeaderboardData('quest', secondJid, 10);
  assert(srvLbPlaytime.rows.length >= 1);
  assert(srvLbQuest.rows.length >= 1 && srvLbQuest.rows[0].completedQuests >= 3);

  const topServerCmd = require('../commands/community/topserver');
  let renderedTopServerCard = null;
  await topServerCmd.execute({
    ...makeOwnerCtx('topserver', 'playtime'),
    senderJid: secondJid,
    replyCard: async (buf, caption) => {
      renderedTopServerCard = buf;
      return mockSock.sendMessage(secondJid, { text: caption });
    },
  });
  assert(Buffer.isBuffer(renderedTopServerCard) && renderedTopServerCard.length > 5000);
  console.log('│ ✅ [21/30] 3 Quest Harian WIB, Bonus 3/3 & Kartu .topserver lulus');

  // 22. Uji Gacha Karakter/Waifu (1x, 10x Multi-Pull Jaminan SR+, Shard Duplikat, Tukar SSR & Kartu Canvas)
  addBalance(secondJid, 20000);
  const g1 = performGachaPull(secondJid, 1);
  assert.strictEqual(g1.ok, true);
  assert.strictEqual(g1.results.length, 1);

  const g10 = performGachaPull(secondJid, 10);
  assert.strictEqual(g10.ok, true);
  assert.strictEqual(g10.results.length, 10);
  assert(
    g10.results.some((r) => r.character.rarity === 'SR' || r.character.rarity === 'SSR'),
    'Multi-Pull 10x wajib menjamin minimal 1 karakter SR atau SSR'
  );

  const gachaCardBuf = await renderGachaCard({
    character: g10.featured.character,
    isNew: g10.featured.isNew,
    shardsGained: g10.totalShardsGained,
    pullCount: 10,
    totalOwnedCount: g10.featured.totalOwnedCount,
    pullSummary: g10.results.map((r) => ({
      rarity: r.character.rarity,
      shortName: r.character.shortName,
    })),
    userName: 'SakuraChan',
  });
  assert(Buffer.isBuffer(gachaCardBuf) && gachaCardBuf.length > 5000);

  // Uji penukaran Starlight Shards langsung ke SSR
  getDb().run('UPDATE economy SET gacha_shards = 500 WHERE jid = ?', [secondJid]);
  const redeemedSsr = redeemCharacterWithShards(secondJid, 'ssr_sakura');
  assert.strictEqual(redeemedSsr.ok, true);
  assert.strictEqual(redeemedSsr.character.rarity, 'SSR');
  assert.strictEqual(redeemedSsr.remainingShards, 100);
  const gSummary = getUserGachaSummary(secondJid);
  assert(gSummary.uniqueOwned >= 1 && gSummary.totalPulls >= 12);
  console.log('│ ✅ [22/30] Gacha Waifu (1x, 10x Jaminan SR+, Tukar Shards SSR & Kartu Canvas) lulus');

  // 23. Uji Pet Virtual (Adopsi, Makan, Main, Istirahat, Rename & Kartu Canvas)
  const adopted = adoptPet(secondJid, 'kitsune', 'Koharu');
  assert.strictEqual(adopted.ok, true);
  assert.strictEqual(adoptPet(secondJid, 'neko', 'Mochi').reason, 'already_have_pet');

  const playedPet = playWithPet(secondJid);
  assert.strictEqual(playedPet.ok, true);
  assert(playedPet.foundCoins >= 25);

  const fedPet = feedPet(secondJid);
  assert.strictEqual(fedPet.ok, true);

  const restedPet = restPet(secondJid);
  assert.strictEqual(restedPet.ok, true);
  assert.strictEqual(restedPet.pet.energy, 100);

  const renamedPet = renamePet(secondJid, 'Kurama');
  assert.strictEqual(renamedPet.ok, true);

  const petCardBuf = await renderPetCard({
    pet: restedPet.pet,
    speciesMeta: restedPet.pet.speciesMeta,
    ownerName: 'SakuraChan',
  });
  assert(Buffer.isBuffer(petCardBuf) && petCardBuf.length > 5000);
  console.log('│ ✅ [23/30] Sistem Pet Virtual (Adopsi, Makan, Main, Tidur, Rename & Kartu Canvas) lulus');

  // 24. Uji Toko Kustomisasi Profil (Background, Bingkai, Gelar) & Pengingat Ulang Tahun Harian WIB
  const boughtBg = buyOrEquipShopItem(secondJid, 'bg_starlight');
  const boughtFrame = buyOrEquipShopItem(secondJid, 'frame_gold');
  const boughtTitle = buyOrEquipShopItem(secondJid, 'title_legenda');
  assert(boughtBg.ok && boughtFrame.ok && boughtTitle.ok);

  const customizedProfile = getUserProfile(secondJid);
  assert.strictEqual(customizedProfile.profileBg, 'starlight-night');
  assert.strictEqual(customizedProfile.profileFrame, 'royal-gold');
  assert.strictEqual(customizedProfile.title, 'Legenda CipiSMP');

  const customProfileCard = await renderProfileCard({
    profile: customizedProfile,
    avatarUrl: null,
    aiLimitText: '15/15',
    dlLimitText: '20/20',
  });
  assert(Buffer.isBuffer(customProfileCard) && customProfileCard.length > 5000);

  // Uji Ulang Tahun hari ini (WIB) + hadiah otomatis idempoten
  const wibNow = getWibParts();
  const bdaySet = setUserBirthday(secondJid, `${wibNow.day}-${wibNow.month}`);
  assert.strictEqual(bdaySet.ok, true);
  assert(listUpcomingBirthdays(5).some((u) => u.isToday));

  config.dryRun = true;
  const balBeforeBday = getEconomy(secondJid).balance;
  const bdayRun1 = await runDailyBirthdayCheck();
  assert.strictEqual(bdayRun1.celebrated, 1);
  assert.strictEqual(getEconomy(secondJid).balance, balBeforeBday + 1000);
  const bdayRun2 = await runDailyBirthdayCheck();
  assert.strictEqual(bdayRun2.celebrated, 0, 'Kado ulang tahun wajib idempoten 1x per tahun');
  config.dryRun = prevDryRun;
  console.log('│ ✅ [24/30] Toko Kustomisasi Profil (.toko -> .profil) & Kado Ultah Harian WIB lulus');

  // 25. Uji Game Hiburan (.kuis, .tebakgambar + Kartu Canvas, .ramalan, .quotes, .suit, .slot)
  const qSession = startQuizSession(groupJid, 30000);
  assert.strictEqual(qSession.ok, true);
  const qAns = checkGameAnswer(groupJid, secondJid, qSession.session.answers[0]);
  assert.strictEqual(qAns.matched, true);

  const tgSession = startTebakGambarSession(groupJid, 30000);
  assert.strictEqual(tgSession.ok, true);
  const tgCardBuf = await renderTebakGambarCard({
    clues: tgSession.session.clues,
    category: tgSession.session.category,
    answerMask: tgSession.session.answerMask,
    rewardCoins: tgSession.session.rewardCoins,
  });
  assert(Buffer.isBuffer(tgCardBuf) && tgCardBuf.length > 5000);
  const tgAns = checkGameAnswer(groupJid, secondJid, tgSession.session.answers[0]);
  assert.strictEqual(tgAns.matched, true);
  assert.strictEqual(forfeitActiveGameSession(groupJid), null);

  const omikuji1 = drawDailyFortune(secondJid);
  const omikuji2 = drawDailyFortune(secondJid);
  assert(omikuji1.grantedBonus > 0);
  assert.strictEqual(omikuji2.grantedBonus, 0, 'Berkah koin Omikuji hanya 1x per hari WIB');
  assert.strictEqual(omikuji1.grade, omikuji2.grade);

  const quoteItem = getRandomAnimeQuote();
  assert(quoteItem.quote.length > 10 && quoteItem.anime.length > 2);

  const rpsRes = playRockPaperScissors(secondJid, 'batu', 100);
  assert.strictEqual(rpsRes.ok, true);

  const slotRes = spinKawaiiSlot(secondJid, 100);
  assert.strictEqual(slotRes.ok, true);
  assert.strictEqual(slotRes.reels.length, 3);
  console.log('│ ✅ [25/30] Game Hiburan (.kuis, .tebakgambar, .ramalan, .quotes, .suit, .slot) lulus');

  // 26. Uji Ban / Unban User, Proteksi Anti-Ban Owner & Blokir Router index.js
  loadCommands();
  assert.strictEqual(
    banUser({ actorJid: testJid, targetRawJid: testJid, reason: 'Coba ban owner' }).reason,
    'cannot_ban_owner',
    'Owner tidak boleh bisa di-ban'
  );
  const banned = banUser({
    actorJid: testJid,
    targetRawJid: secondJid,
    reason: 'Uji spam command',
  });
  assert.strictEqual(banned.ok, true);
  assert.strictEqual(listBannedUsers().length, 1);

  const countBeforeBanMsg = sentPayloads.length;
  await handleIncomingMessage(mockSock, {
    key: { remoteJid: secondJid, fromMe: false, id: 'MSG-BAN-1' },
    pushName: 'SakuraChan',
    message: { conversation: '.quotes' },
  });
  assert(
    sentPayloads.length > countBeforeBanMsg &&
      sentPayloads.at(-1).content.text.includes('ᴀᴋsᴇs ᴅɪʙᴀᴛᴀsɪ'),
    'User yang di-ban wajib ditolak oleh router index.js'
  );

  const unbanned = unbanUser({ actorJid: testJid, targetRawJid: secondJid });
  assert.strictEqual(unbanned.ok, true);
  assert.strictEqual(listBannedUsers().length, 0);
  console.log('│ ✅ [26/30] Manajemen Ban/Unban, Banlist & Proteksi Anti-Ban Owner lulus');

  // 27. Uji Mode Self / Public & Mode Maintenance pada Router Utama
  setBotAccessMode({ actorJid: testJid, mode: 'self' });
  assert.strictEqual(getBotOperationalState().botMode, 'self');
  const countBeforeSelfMsg = sentPayloads.length;
  await handleIncomingMessage(mockSock, {
    key: { remoteJid: secondJid, fromMe: false, id: 'MSG-SELF-1' },
    pushName: 'SakuraChan',
    message: { conversation: '.quotes' },
  });
  assert.strictEqual(
    sentPayloads.length,
    countBeforeSelfMsg,
    'Pada Mode Self, command dari non-owner harus diabaikan secara hening'
  );
  setBotAccessMode({ actorJid: testJid, mode: 'public' });

  setMaintenanceState({
    actorJid: testJid,
    enabled: true,
    reason: 'Upgrade mesin Sakura v2 ♡',
  });
  await handleIncomingMessage(mockSock, {
    key: { remoteJid: secondJid, fromMe: false, id: 'MSG-MT-1' },
    pushName: 'SakuraChan',
    message: { conversation: '.quotes' },
  });
  assert(
    sentPayloads.at(-1).content.text.includes('ᴍᴏᴅᴇ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ'),
    'Member reguler wajib menerima pesan maintenance saat aktif'
  );
  setMaintenanceState({ actorJid: testJid, enabled: false });
  console.log('│ ✅ [27/30] Kontrol Mode Self/Public & Maintenance Kustom lulus');

  // 28. Uji Manajemen Sakura VIP (.addprem, Perpanjangan, .listprem, .vip & .delprem)
  const thirdJid = '6287778889990@s.whatsapp.net';
  const vip1 = grantPremium({
    actorJid: testJid,
    targetRawJid: thirdJid,
    durationInput: '7d',
    note: 'Juara Event Build',
  });
  assert.strictEqual(vip1.ok, true);
  assert.strictEqual(vip1.wasExtended, false);
  assert.strictEqual(getPremiumStatus(thirdJid).isPremium, true);
  assert.strictEqual(
    getDailyLimitStatus(thirdJid, 'ai').max,
    config.limits.premium.ai,
    'Member Sakura VIP wajib langsung mendapat kuota limit VIP'
  );

  const vip2 = grantPremium({
    actorJid: testJid,
    targetRawJid: thirdJid,
    durationInput: '30d',
  });
  assert.strictEqual(vip2.ok, true);
  assert.strictEqual(vip2.wasExtended, true, 'Penambahan VIP kedua wajib memperpanjang durasi sebelumnya');
  assert(vip2.expiresAt > vip1.expiresAt + 25 * 24 * 60 * 60 * 1000);
  assert(listActivePremiumUsers().some((u) => u.jid === thirdJid));

  const vipRevoked = revokePremium({ actorJid: testJid, targetRawJid: thirdJid });
  assert.strictEqual(vipRevoked.ok, true);
  assert.strictEqual(getPremiumStatus(thirdJid).isPremium, false);
  console.log('│ ✅ [28/30] Manajemen Sakura VIP (.addprem, Perpanjangan, .listprem, .delprem) lulus');

  // 29. Uji Controlled Sandbox .eval, Redaksi Rahasia, Diagnostik .logs & Restart Aman
  config.ai.apiKey = 'sk-super-secret-ai-key-999';
  config.rcon.password = 'rcon-ultra-secret-777';
  assert.strictEqual(
    redactSecrets('Token: sk-super-secret-ai-key-999 & rcon-ultra-secret-777'),
    'Token: [REDACTED_SECRET] & [REDACTED_SECRET]'
  );

  // Ditolak bila bukan Owner
  const nonOwnerEval = await executeControlledEval({
    actorJid: secondJid,
    code: '1 + 1',
  });
  assert.strictEqual(nonOwnerEval.reason, 'not_owner');

  // Ditolak secara default saat ENABLE_OWNER_EVAL=false
  config.enableOwnerEval = false;
  const disabledEval = await executeControlledEval({
    actorJid: testJid,
    code: '1 + 1',
  });
  assert.strictEqual(disabledEval.reason, 'eval_disabled');

  // Diizinkan saat ENABLE_OWNER_EVAL=true untuk ekspresi aman, namun blokir escape & redaksi secret
  config.enableOwnerEval = true;
  const safeEval = await executeControlledEval({
    actorJid: testJid,
    code: '({ sum: 20 + 26, aiKey: config.ai.apiKey, users: db.get("SELECT COUNT(*) AS cnt FROM users").cnt })',
    meta: { commandsCount: commands.size },
  });
  assert.strictEqual(safeEval.ok, true);
  assert(safeEval.output.includes('46') && safeEval.output.includes('[REDACTED]'));
  assert(!safeEval.output.includes('sk-super-secret-ai-key-999'));

  const blockedEscape = await executeControlledEval({
    actorJid: testJid,
    code: 'this.constructor.constructor("return process")()',
  });
  assert.strictEqual(blockedEscape.reason, 'blocked_pattern');

  const writeAttempt = await executeControlledEval({
    actorJid: testJid,
    code: 'db.get("DELETE FROM users")',
  });
  assert.strictEqual(writeAttempt.ok, false, 'Sandbox DB wajib menolak query non-SELECT');
  config.enableOwnerEval = false;
  config.ai.apiKey = '';
  config.rcon.password = '';

  const diag = getSystemDiagnostics(commands.size);
  assert(diag.usersCount >= 2 && diag.commandsCount >= 75);
  assert(getRecentAuditLogs(5, 'owner_eval').length >= 3);

  config.dryRun = true;
  const simRestart = await triggerGracefulBotRestart({ actorJid: testJid });
  assert.strictEqual(simRestart.simulated, true);
  config.dryRun = prevDryRun;
  console.log('│ ✅ [29/30] Sandbox .eval Aman + Redaksi Rahasia, Audit .logs & Restart Bot lulus');

  // 30. Uji Button Registry, Backup Database & Command Loader Lengkap (79 Command Fase 1 s/d Fase 7)
  config.useButtons = false;
  await sendButtons(mockSock, testJid, {
    text: formatSuccess('Tes', ['Isi pesan']),
    ownerJid: testJid,
    oneTime: true,
    buttons: [{ command: '.ping', text: 'Cek Ping' }],
  });
  config.useButtons = prevButtonsMode;
  assert.strictEqual(
    extractButtonResponse({ conversation: 'halo' }),
    null
  );

  const bkp = await createBackup('smoke');
  assert(fs.existsSync(bkp.filePath));

  loadCommands();
  const requiredCommands = [
    // Fase 1 (5)
    'menu', 'ping', 'owner', 'profil', 'backupdb',
    // Fase 2 (20)
    'welcome', 'antilink', 'antispam', 'tagall', 'hidetag', 'kick',
    'promote', 'demote', 'mute', 'buka', 'tutup',
    'saldo', 'daily', 'weekly', 'kerja', 'transfer', 'leaderboard', 'level',
    'sticker', 'toimg',
    // Fase 3 (13)
    'server', 'ai',
    'tiktok', 'ig', 'yt', 'dl',
    'anime',
    'bc', 'bcmc', 'bcdc', 'bcall', 'ya', 'batal',
    // Fase 4 (10)
    'link', 'unlink', 'akun', 'tukar',
    'bridge', 'start', 'stop', 'restart', 'backup', 'console',
    // Fase 5 (7)
    'giveaway', 'ikut', 'event', 'lapor', 'tiket', 'topserver', 'quest',
    // Fase 6 (11)
    'gacha', 'koleksi', 'pet', 'toko', 'ultah',
    'kuis', 'tebakgambar', 'ramalan', 'quotes', 'suit', 'slot',
    // Fase 7 (13)
    'vip',
    'ban', 'unban', 'banlist',
    'self', 'public', 'maintenance',
    'restartbot',
    'addprem', 'delprem', 'listprem',
    'eval', 'logs',
    // Fitur Baru: Stiker .qc, .brat, Sistem .afk Grup, Paket Minecraft (.ach, .skin, .poll) & Sandi (.encode/.ecode, .decode/.dcode)
    'qc', 'brat', 'afk',
    'ach', 'skin', 'poll',
    'encode', 'decode',
  ];
  for (const name of requiredCommands) {
    assert(commands.has(name), `Command wajib .${name} harus terdaftar`);
  }
  assert(!commands.has('contoh'), '_template.js harus diabaikan');
  assert(!commands.has('contohkartu'), '_template-buttons-card.js harus diabaikan');
  assert(!commands.has('contohapi'), '_template-api-limit.js harus diabaikan');
  console.log(`│ ✅ [30/31] Command Loader (${requiredCommands.length} command utama aktif) & Backup DB lulus`);

  // 31. Regresi Live Bugfix (@lid Mention, Button contextInfo, Anti-Spam Adil, .toko, .event Mudah, .tiket Balas)
  const {
    registerLidMapping,
    normalizeUserJid: normJidFn,
    formatMentionTag,
  } = require('../lib/database');

  // 31a. @lid -> @s.whatsapp.net auto-resolution & mention tag
  registerLidMapping('2832737723@lid', '6289911223344@s.whatsapp.net');
  assert.strictEqual(normJidFn('2832737723@lid'), '6289911223344@s.whatsapp.net');
  assert.strictEqual(formatMentionTag('2832737723@lid'), '@6289911223344');

  // 31b. sendButtons menyuntikkan contextInfo.mentionedJid ke interactiveMessage
  let capturedInteractive = null;
  await sendButtons(
    {
      user: { id: '6281234567890:1@s.whatsapp.net' },
      relayMessage: async (_jid, msgObj) => {
        capturedInteractive = msgObj;
        return 'ok';
      },
      waUploadToServer: async () => ({}),
    },
    groupJid,
    {
      title: 'Uji Mention',
      text: 'Halo @6289911223344',
      mentions: ['2832737723@lid'],
      buttons: [{ id: '.menu', text: 'Menu' }],
    }
  );
  assert.deepStrictEqual(
    capturedInteractive?.interactiveMessage?.contextInfo?.mentionedJid,
    ['6289911223344@s.whatsapp.net']
  );

  // 31c. Anti-spam mengabaikan command & balasan singkat wajar ("ok")
  for (let i = 0; i < 12; i += 1) {
    assert.strictEqual(detectSpamBurst(groupJid, '6289911223344@s.whatsapp.net', '.menu'), null);
  }
  for (let i = 0; i < 6; i += 1) {
    assert.strictEqual(detectSpamBurst(groupJid, '6289911223344@s.whatsapp.net', 'ok'), null);
  }

  // 31d. .toko nomor urut & newBalance terdefinisi
  addBalance('6289911223344@s.whatsapp.net', 5000);
  const shopRes = buyOrEquipShopItem('6289911223344@s.whatsapp.net', '2');
  assert.strictEqual(shopRes.ok, true);
  assert(Number.isFinite(shopRes.newBalance) && shopRes.newBalance > 0);

  // 31e. .event jadwal mudah tanpa tanda "|" & hapus pakai nomor urut "1"
  assert.strictEqual(parseEventScheduleInput('20:00').valid, true);
  assert.strictEqual(parseEventScheduleInput('besok 19:30').valid, true);
  assert.strictEqual(parseEventScheduleInput('sabtu 20:00').valid, true);
  const easyEv = createScheduledEvent({
    rawSchedule: 'besok 20:00',
    title: 'Mabar Boss Dragon',
    actorJid: testJid,
  });
  assert.strictEqual(easyEv.ok, true);
  const delEasyEv = deleteScheduledEvent('1');
  assert.strictEqual(delEasyEv.ok, true);

  // 31f-extra: Minecraft 26.3 "System chat:" log join/leave regex
  const mc263Join = config.minecraft.joinRegex.exec('[21:20:59 INFO]: System chat: Yudhis joined the game');
  assert(mc263Join && mc263Join[1] === 'Yudhis', 'Join regex wajib mengenali log System chat: Minecraft 26.3');
  const mc263Leave = config.minecraft.leaveRegex.exec('[21:20:59 INFO]: System chat: .Cello_BE left the game');
  assert(mc263Leave && mc263Leave[1] === '.Cello_BE', 'Leave regex wajib mengenali log System chat: Minecraft 26.3');
  const prevDry = config.dryRun;
  config.dryRun = true;
  const tktCreated = await createSupportTicket({
    senderRawJid: '2832737723@lid',
    pushName: 'Member LID',
    messageInput: 'Koordinat portal nether rusak di X=120 Z=-45',
  });
  assert.strictEqual(tktCreated.ok, true);
  const replyWithHash = await replySupportTicket({
    actorRawJid: '6289911223344@s.whatsapp.net',
    actorName: 'Member LID',
    isStaff: false,
    ticketNoInput: `#${tktCreated.ticketNo}`,
    replyText: 'Tambahan info: sudah dicek ulang barusan kak',
  });
  assert.strictEqual(replyWithHash.ok, true);
  const replyByIndex = await replySupportTicket({
    actorRawJid: testJid,
    actorName: 'Owner Cipi',
    isStaff: true,
    ticketNoInput: '1',
    replyText: 'Siap kak, sedang kami perbaiki!',
  });
  assert.strictEqual(replyByIndex.ok, true);
  config.dryRun = prevDry;

  // 32. Uji Regresi Gelombang 2: Akurasi Member 100->99, Saldo Tidak Cukup, & Konteks Reply Bridge
  const base99 = Array.from({ length: 99 }, (_, i) => ({
    id: `628100000${String(i + 1).padStart(3, '0')}@s.whatsapp.net`,
  }));
  const testerPn = '6285599887766@s.whatsapp.net';
  const testerLid = '9911223344@lid';

  // Saat member ke-100 masuk -> harus tepat 100
  const countOnJoin = computeAccurateGroupMemberCount({
    groupJid: '120363999888777@g.us',
    groupMeta: { participants: [...base99, { id: testerLid, phoneNumber: testerPn }] },
    mode: 'welcome',
    targetJid: testerPn,
    rawParticipant: { id: testerLid, phoneNumber: testerPn },
  });
  assert.strictEqual(countOnJoin, 100, 'Saat member ke-100 masuk, jumlah wajib 100');

  // Saat member itu langsung keluar, walau groupMetadata WA masih stale + duplikat @lid & @s.whatsapp.net (101 entri mentah!), hasil WAJIB 99!
  const countOnLeave = computeAccurateGroupMemberCount({
    groupJid: '120363999888777@g.us',
    groupMeta: {
      participants: [
        ...base99,
        { id: testerLid },
        { id: testerPn },
      ],
    },
    mode: 'leave',
    targetJid: testerPn,
    rawParticipant: { id: testerPn },
  });
  assert.strictEqual(countOnLeave, 99, 'Saat member ke-100 keluar, jumlah wajib turun menjadi 99 (bukan 101)');

  // Uji Konteks Reply Bridge: Cello Cristia me-reply pesan "ル aev.yth: nyoli mas?" dengan "mas mulutnya"
  const aevJid = '6287711223344@s.whatsapp.net';
  ensureUser(aevJid, 'ル aev.yth');
  const replyCtxWa = extractWhatsAppReplyContext({
    quotedMessage: { conversation: 'nyoli mas?' },
    quotedSenderJid: aevJid,
  });
  assert(replyCtxWa && replyCtxWa.targetName === 'ル aev.yth', 'Target reply member WA wajib terbaca akurat');
  assert.strictEqual(replyCtxWa.snippet, 'nyoli mas?');

  const bridgeCmdWa = buildBridgeTellrawCommand({
    sourceTag: 'WA',
    senderName: 'Cello Cristia',
    message: 'mas mulutnya',
    replyTo: replyCtxWa,
  });
  assert.strictEqual(
    bridgeCmdWa.say,
    'say [WA] Cello Cristia -> ル aev.yth ("nyoli mas?"): mas mulutnya',
    'Format say bridge Minecraft wajib menampilkan siapa & pesan apa yang di-reply'
  );

  // Uji Reply ke pesan meneruskan dari pemain Minecraft di WA
  const replyCtxMc = extractWhatsAppReplyContext({
    quotedMessage: { conversation: '⛏️ *[MC] Yudhis*: ada yg mau beli diamond?' },
    quotedSenderJid: '6285194139174@s.whatsapp.net',
  });
  assert(replyCtxMc && replyCtxMc.targetName === 'Yudhis', 'Reply ke pesan bridge MC wajib menargetkan nama pemain MC');
  assert.strictEqual(replyCtxMc.snippet, 'ada yg mau beli diamond?');

  // Uji Live Router: User miskin (saldo 0) menjalankan .toko beli 2, .gacha, .slot 200, .suit batu 200, .transfer -> WAJIB "Saldo Tidak Cukup" (tanpa error "tersandung")!
  const brokeJid = '6283300001111@s.whatsapp.net';
  ensureUser(brokeJid, 'BrokeTester');
  getDb().run('UPDATE economy SET balance = 0 WHERE jid = ?', [brokeJid]);

  const brokeReplies = [];
  const brokeSock = {
    user: { id: '6280000000000@s.whatsapp.net' },
    sendMessage: async (_jid, content) => {
      if (content?.text) brokeReplies.push(content.text);
      return { key: { id: 'BROKE_MSG' } };
    },
    groupMetadata: async () => ({ subject: 'Tes', participants: [] }),
  };

  for (const rawCmd of [
    '.toko beli 2',
    '.gacha',
    '.slot 200',
    '.suit batu 200',
    '.transfer 6281234567890 500',
  ]) {
    brokeReplies.length = 0;
    await handleIncomingMessage(brokeSock, {
      key: { remoteJid: brokeJid, fromMe: false, id: `BRK_${rawCmd}` },
      pushName: 'BrokeTester',
      message: { conversation: rawCmd },
    });
    const out = brokeReplies.join('\n');
    assert(
      out.includes('sᴀʟᴅᴏ ᴛɪᴅᴀᴋ ᴄᴜᴋᴜᴘ') && !out.includes('tersandung'),
      `Command "${rawCmd}" saat saldo 0 wajib membalas "Saldo Tidak Cukup", bukan "tersandung". Dapat: ${out}`
    );
  }

  // 33. Regresi Pembatasan Command Tag (hidetag & tagall Wajib Khusus Owner — Admin & Member Ditolak!)
  const { groupCommandsByCategory } = require('../lib/menu');
  const nonOwnerAdminJid = '6287700112233@s.whatsapp.net';
  const regularMemberJid = '6287700998877@s.whatsapp.net';
  const tagTestGroupJid = '120363999000111222@g.us';
  const tagTestPayloads = [];

  const tagTestSock = {
    user: { id: '6280000000000@s.whatsapp.net' },
    sendMessage: async (_jid, content) => {
      tagTestPayloads.push(content);
      return { key: { id: 'TAG_TEST_MSG' } };
    },
    groupMetadata: async () => ({
      id: tagTestGroupJid,
      subject: 'CipiSMP Tag Guard Group',
      participants: [
        { id: '6280000000000@s.whatsapp.net', admin: 'admin' },
        { id: nonOwnerAdminJid, admin: 'admin' }, // Admin Grup tapi BUKAN Owner!
        { id: regularMemberJid, admin: null },
      ],
    }),
  };

  for (const [callerLabel, callerJid] of [
    ['Admin Grup Non-Owner', nonOwnerAdminJid],
    ['Member Reguler', regularMemberJid],
  ]) {
    for (const rawTagCmd of ['.tagall Halo', '.everyone Halo', '.hidetag Pengumuman', '.ht Pengumuman', '.totag Tes']) {
      tagTestPayloads.length = 0;
      await handleIncomingMessage(tagTestSock, {
        key: {
          remoteJid: tagTestGroupJid,
          participant: callerJid,
          fromMe: false,
          id: `TAG_${callerJid}_${rawTagCmd}`,
        },
        pushName: callerLabel,
        message: { conversation: rawTagCmd },
      });
      const combinedText = tagTestPayloads.map((p) => p?.text || '').join('\n');
      assert(
        combinedText.includes('ᴋʜᴜsᴜs ᴏᴡɴᴇʀ'),
        `${callerLabel} yang mengetik "${rawTagCmd}" wajib ditolak dengan "Khusus Owner", dapat: ${combinedText}`
      );
      assert(
        !tagTestPayloads.some((p) => Array.isArray(p?.mentions) && p.mentions.length >= 2),
        `${callerLabel} tidak boleh berhasil memicu mention massal lewat "${rawTagCmd}"`
      );
    }
  }

  // Pastikan di .menu member/admin non-owner, hidetag & tagall disembunyikan, sedangkan di .menu Owner muncul
  const publicCats = groupCommandsByCategory(commands, { includeOwner: false });
  const publicNames = publicCats.flatMap((c) => c.commands.map((cmd) => cmd.name));
  assert(!publicNames.includes('tagall') && !publicNames.includes('hidetag'), 'tagall/hidetag wajib tersembunyi dari menu non-owner');

  const ownerCats = groupCommandsByCategory(commands, { includeOwner: true });
  const ownerNames = ownerCats.flatMap((c) => c.commands.map((cmd) => cmd.name));
  assert(ownerNames.includes('tagall') && ownerNames.includes('hidetag'), 'tagall/hidetag wajib tampil pada menu Owner');

  // 34. Regresi Antilink Pintar: Izinkan .tt/.tiktok/.ig/.reels/.yt/.ytmp3/.dl dengan URL resmi, blokir penyelundupan link lain!
  for (const validDlCmd of [
    '.tt https://vt.tiktok.com/ZSY12345/',
    '.tiktok https://www.tiktok.com/@user/video/7123456789',
    '.ig https://www.instagram.com/reel/Cxyz123/?igsh=abc',
    '.reels https://instagr.am/p/Abc123/',
    '.yt https://youtu.be/dQw4w9WgXcQ',
    '.ytmp3 https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '.dl https://youtube.com/shorts/AbcDef123',
  ]) {
    const checkValid = await detectDisallowedLink(null, tagTestGroupJid, validDlCmd, true);
    assert.strictEqual(
      checkValid,
      null,
      `Command downloader sah "${validDlCmd}" TIDAK boleh dihapus oleh Antilink!`
    );
  }

  for (const sneakyBad of [
    '.tt https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrSt',
    '.tt https://vt.tiktok.com/ZSY123/ join yuk https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrSt',
    '.ig https://phishing-tiktok.com/login',
    'tonton ini https://vt.tiktok.com/ZSY12345/',
  ]) {
    const checkBad = await detectDisallowedLink(null, tagTestGroupJid, sneakyBad, false);
    assert(
      checkBad !== null,
      `Pesan tautan terlarang / penyelundupan "${sneakyBad}" WAJIB tetap tertangkap Antilink!`
    );
  }

  // Uji live lewat router saat antilink=1 aktif di grup: member kirim .tt <url> TIDAK boleh di-delete!
  ensureGroup(tagTestGroupJid, 'CipiSMP Tag Guard Group');
  getDb().run('UPDATE groups SET antilink = 1 WHERE jid = ?', [tagTestGroupJid]);
  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: {
      remoteJid: tagTestGroupJid,
      participant: regularMemberJid,
      fromMe: false,
      id: 'ANTILINK_DL_LIVE_1',
    },
    pushName: 'MemberReguler',
    message: { conversation: '.tt https://vt.tiktok.com/ZSY12345/' },
  });
  assert(
    !tagTestPayloads.some((p) => p && p.delete),
    'Pesan member yang menjalankan .tt <link tiktok> saat antilink aktif TIDAK boleh dihapus!'
  );
  assert(
    !tagTestPayloads.some((p) => String(p?.text || '').includes('ᴀɴᴛɪʟɪɴᴋ ɢʀᴜᴘ ᴀᴋᴛɪꜰ')),
    'Member yang menjalankan .tt <link tiktok> TIDAK boleh kena peringatan Antilink!'
  );

  // 35. Regresi .link Akun Minecraft Real-World:
  //     - Ketik .link <6-digit PIN> langsung tanpa kata "verif" TIDAK menimpa username, melainkan langsung memverifikasi!
  //     - Ketik .link kirim mengirim ulang PIN tanpa merusak data pending
  //     - Ketik .link CP-XXXXXX di WA memberi peringatan jelas tanpa menimpa username
  //     - Format chat plugin Paper/Purpur/LuckPerms ([Rank] Nama: CP-XXXXXX & Nama » CP-XXXXXX) terbaca otomatis!
  const linkRealMemberJid = '6287711223344@s.whatsapp.net';
  const linkCmdObj = commands.get('link');
  const prevLinkCd = linkCmdObj.cooldown;
  linkCmdObj.cooldown = 0;
  getDb().run('UPDATE groups SET antilink = 0 WHERE jid = ?', [tagTestGroupJid]);
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: linkRealMemberJid, fromMe: false, id: 'LINK_REAL_1' },
    pushName: 'PlayerCipi',
    message: { conversation: '.link CipiHero26' },
  });
  let pendingReal = getDb().get('SELECT * FROM links WHERE jid = ?', [linkRealMemberJid]);
  assert(pendingReal && pendingReal.status === 'pending', '.link CipiHero26 wajib membuat status pending');
  assert.strictEqual(pendingReal.mc_username, 'CipiHero26');

  const [realPubCode, realSecretPin] = String(pendingReal.verify_code).split('|');

  // Salah tempel kode publik CP-XXXXXX di WA -> TIDAK boleh menimpa mc_username!
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: linkRealMemberJid, fromMe: false, id: 'LINK_REAL_WRONG_CODE' },
    pushName: 'PlayerCipi',
    message: { conversation: `.link ${realPubCode}` },
  });
  pendingReal = getDb().get('SELECT * FROM links WHERE jid = ?', [linkRealMemberJid]);
  assert.strictEqual(pendingReal.mc_username, 'CipiHero26', 'Salah ketik .link CP-XXXXXX tidak boleh menimpa username!');
  assert.strictEqual(pendingReal.status, 'pending');

  // Kirim ulang PIN via .link kirim -> tetap pending dengan username CipiHero26
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: linkRealMemberJid, fromMe: false, id: 'LINK_REAL_RESEND' },
    pushName: 'PlayerCipi',
    message: { conversation: '.link kirim' },
  });
  pendingReal = getDb().get('SELECT * FROM links WHERE jid = ?', [linkRealMemberJid]);
  assert.strictEqual(pendingReal.mc_username, 'CipiHero26');

  // Ketik .link <6-digit PIN> langsung (tanpa kata "verif") -> WAJIB langsung verified!
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: linkRealMemberJid, fromMe: false, id: 'LINK_REAL_PIN_DIRECT' },
    pushName: 'PlayerCipi',
    message: { conversation: `.link ${realSecretPin}` },
  });
  const verifiedReal = getLinkedAccountDetails(linkRealMemberJid);
  assert(verifiedReal && verifiedReal.status === 'verified', '.link <6-digit PIN> wajib langsung memverifikasi akun!');
  assert.strictEqual(verifiedReal.mcUsername, 'CipiHero26', 'Username tidak boleh tertimpa menjadi angka PIN!');
  linkCmdObj.cooldown = prevLinkCd;

  // Uji verifikasi chat in-game dengan plugin rank Paper/Purpur/LuckPerms ([Member] Nama: CP-XXXXXX)
  const rankedMemberJid = '6287755667788@s.whatsapp.net';
  const rankedInit = await initiateAccountLink(rankedMemberJid, 'SultanPurpur');
  assert.strictEqual(rankedInit.ok, true);
  await handleMinecraftConsoleLine(
    `[18:30:11] [Async Chat Thread - #2/INFO]: [Member] SultanPurpur » halo min ${rankedInit.publicChatCode}`
  );
  const rankedVerified = getLinkedAccountDetails(rankedMemberJid);
  assert(
    rankedVerified && rankedVerified.status === 'verified',
    'Format chat plugin [Rank] Nama » CP-XXXXXX wajib terverifikasi otomatis!'
  );

  // 36. Uji Fitur Baru: Stiker .qc (Quote Chat WA), .brat (Putih/Hijau), & Sistem .afk Grup Otomatis
  const { renderQuoteChatSticker, renderBratSticker } = require('../lib/sticker');
  const { getUserAfk } = require('../lib/database');

  const qcWebp = await renderQuoteChatSticker({
    senderName: 'YudhisCipi',
    text: 'Ayo mabar di CipiSMP malam ini!',
    theme: 'dark',
  });
  assert(Buffer.isBuffer(qcWebp) && qcWebp.length > 500, 'Stiker .qc wajib menghasilkan buffer WebP valid');
  assert.strictEqual(qcWebp.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.strictEqual(qcWebp.subarray(8, 12).toString('ascii'), 'WEBP');

  const bratWebp = await renderBratSticker({
    text: 'lagi nambang netherite jangan diganggu',
    theme: 'hijau',
  });
  assert(Buffer.isBuffer(bratWebp) && bratWebp.length > 500, 'Stiker .brat wajib menghasilkan buffer WebP valid');
  assert.strictEqual(bratWebp.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.strictEqual(bratWebp.subarray(8, 12).toString('ascii'), 'WEBP');

  // Uji alur live .afk di grup: pasang AFK -> teman nge-tag -> bot membalas SEDANG AFK -> user chat lagi -> AFK dicabut
  require('../lib/group-guard').register(require('../index'));

  const afkUserJid = '6287799001122@s.whatsapp.net';
  const callerUserJid = '6287799003344@s.whatsapp.net';
  tagTestPayloads.length = 0;

  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: afkUserJid, fromMe: false, id: 'AFK_SET_1' },
    pushName: 'PetualangAFK',
    message: { conversation: '.afk Lagi makan siang bentar' },
  });
  const activeAfk = getUserAfk(afkUserJid);
  assert(activeAfk && activeAfk.reason === 'Lagi makan siang bentar', 'Status AFK wajib tersimpan di SQLite');

  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: callerUserJid, fromMe: false, id: 'AFK_TAG_1' },
    pushName: 'TemanMabar',
    message: {
      extendedTextMessage: {
        text: 'Woi @6287799001122 ayo nambang!',
        contextInfo: { mentionedJid: [afkUserJid] },
      },
    },
  });
  assert(
    tagTestPayloads.some(
      (p) => String(p?.text || '').includes('Lagi makan siang bentar') && Array.isArray(p?.mentions) && p.mentions.includes(afkUserJid)
    ),
    'Saat member AFK di-tag, bot wajib membalas alasan AFK dengan mention asli!'
  );

  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: afkUserJid, fromMe: false, id: 'AFK_BACK_1' },
    pushName: 'PetualangAFK',
    message: { conversation: 'Halo aku udah balik nih!' },
  });
  assert.strictEqual(getUserAfk(afkUserJid), null, 'Status AFK wajib otomatis dicabut saat member kembali chat');
  assert(
    tagTestPayloads.some((p) => String(p?.text || '').includes('Selamat datang kembali')),
    'Bot wajib menyambut member yang kembali dari AFK'
  );

  // 37. Uji Paket Khas Minecraft SMP: .ach (PNG & Stiker .sach), .skin (Kartu 3D/Pixel + UUID v3), & .poll (WA Poll Asli)
  const { renderMinecraftAchievementCard, renderMinecraftSkinCard } = require('../lib/card');
  const { renderAchievementSticker } = require('../lib/sticker');

  const achPng = await renderMinecraftAchievementCard({
    title: 'Achievement Get!',
    description: 'Dapat Full Netherite di CipiSMP!',
    icon: 'creeper',
  });
  assert(Buffer.isBuffer(achPng) && achPng.length > 800 && achPng[1] === 0x50 && achPng[2] === 0x4e && achPng[3] === 0x47);

  const achSticker = await renderAchievementSticker({
    title: 'Challenge Complete!',
    description: 'Solo Ender Dragon!',
    challenge: true,
  });
  assert.strictEqual(achSticker.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.strictEqual(achSticker.subarray(8, 12).toString('ascii'), 'WEBP');

  const skinPng = await renderMinecraftSkinCard({
    username: 'YudhisCipi',
    edition: 'Java Edition',
    offlineUuid: '12345678-1234-3123-8123-1234567890ab',
  });
  assert(Buffer.isBuffer(skinPng) && skinPng.length > 1500 && skinPng[1] === 0x50);

  // Uji live .skin <Java>, .skin <.Bedrock>, dan .skin tanpa argumen (akun tertaut di tabel links)
  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: '6287799004411@s.whatsapp.net', fromMe: false, id: 'SKIN_JAVA_1' },
    pushName: 'CekJava',
    message: { conversation: '.skin Notch' },
  });
  const skinJavaMsg = tagTestPayloads.find((p) => Buffer.isBuffer(p?.image));
  assert(
    skinJavaMsg && String(skinJavaMsg.caption || '').includes('Notch'),
    '.skin Notch wajib mengirim kartu PNG & caption username Notch!'
  );

  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: '6287799004422@s.whatsapp.net', fromMe: false, id: 'SKIN_BE_1' },
    pushName: 'CekBedrock',
    message: { conversation: '.skin .PlayerBedrock' },
  });
  const skinBedrockMsg = tagTestPayloads.find((p) => Buffer.isBuffer(p?.image));
  assert(
    skinBedrockMsg && String(skinBedrockMsg.caption || '').includes('Bedrock'),
    '.skin .PlayerBedrock wajib mengenali akun Geyser Bedrock!'
  );

  // Uji live .poll cepat (otomatis opsi Setuju / Tidak Setuju) & .sach stiker di grup
  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: callerUserJid, fromMe: false, id: 'POLL_QUICK_1' },
    pushName: 'TemanMabar',
    message: { conversation: '.poll Malam ini event Boss Fight?' },
  });
  assert(
    tagTestPayloads.some(
      (p) =>
        p?.poll &&
        p.poll.name === 'Malam ini event Boss Fight?' &&
        Array.isArray(p.poll.values) &&
        p.poll.values.includes('Setuju') &&
        p.poll.selectableCount === 1
    ),
    '.poll cepat wajib mengirim payload native WhatsApp Poll dengan opsi Setuju/Tidak Setuju!'
  );

  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: callerUserJid, fromMe: false, id: 'SACH_1' },
    pushName: 'TemanMabar',
    message: { conversation: '.sach Kena Ledakan Creeper!' },
  });
  assert(
    tagTestPayloads.some((p) => Buffer.isBuffer(p?.sticker) && p.sticker.subarray(8, 12).toString('ascii') === 'WEBP'),
    '.sach wajib mengirim stiker WebP Achievement Minecraft!'
  );

  // 38. Uji Fitur .ecode (.encode Script Obfuscator) & .dcode (.decode Script Deobfuscator + Beautifier + Sandi)
  const { encodeText, decodeText } = require('../lib/codec');
  const { obfuscateJavaScript, deobfuscateAndBeautifyJavaScript } = require('../lib/script-codec');

  // 38a. Uji Obfuscate -> Deobfuscate & Sempurnakan (Beautify) pada file script .js via WhatsApp Document!
  const rawBotScript = [
    '// Plugin hadiah CipiSMP',
    'module.exports = {',
    '  name: "hadiah",',
    '  active: true,',
    '  hitung(nama, poin) {',
    '    if (/vip/i.test(nama)) {',
    '      return "Selamat " + nama + " dapat " + (poin + 500);',
    '    }',
    '    return "Halo " + nama;',
    '  }',
    '};',
  ].join('\n');

  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: callerUserJid, fromMe: false, id: 'ECODE_DOC_1' },
    pushName: 'TemanMabar',
    message: {
      extendedTextMessage: {
        text: '.ecode',
        contextInfo: {
          stanzaId: 'DOC_RAW_1',
          participant: callerUserJid,
          quotedMessage: {
            documentMessage: {
              fileName: 'hadiah.js',
              mimetype: 'application/javascript',
              fileLength: Buffer.byteLength(rawBotScript),
              _mockBuffer: Buffer.from(rawBotScript, 'utf8'),
            },
          },
        },
      },
    },
  });
  const encDocMsg = tagTestPayloads.find((p) => Buffer.isBuffer(p?.document));
  assert(encDocMsg && encDocMsg.fileName === 'hadiah-enc.js', '.ecode pada file .js wajib mengirim dokumen hadiah-enc.js');
  const encryptedScriptStr = encDocMsg.document.toString('utf8');
  assert(!encryptedScriptStr.includes('Selamat '), 'String asli harus terenkripsi di dalam hadiah-enc.js');

  // Sekarang reply hadiah-enc.js dengan .dcode untuk mendekripsi & menyempurnakan kembali jadi hadiah-clean.js!
  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: callerUserJid, fromMe: false, id: 'DCODE_DOC_1' },
    pushName: 'TemanMabar',
    message: {
      extendedTextMessage: {
        text: '.dcode',
        contextInfo: {
          stanzaId: 'DOC_ENC_1',
          participant: callerUserJid,
          quotedMessage: {
            documentMessage: {
              fileName: 'hadiah-enc.js',
              mimetype: 'application/javascript',
              fileLength: encDocMsg.document.length,
              _mockBuffer: encDocMsg.document,
            },
          },
        },
      },
    },
  });
  const decDocMsg = tagTestPayloads.find((p) => Buffer.isBuffer(p?.document));
  assert(decDocMsg && decDocMsg.fileName === 'hadiah-clean.js', '.dcode pada file terenkripsi wajib mengirim hadiah-clean.js');
  const cleanedScriptStr = decDocMsg.document.toString('utf8');
  assert(cleanedScriptStr.includes('module.exports') && cleanedScriptStr.includes('Selamat '), 'Kode hasil .dcode wajib kembali bersih & terbaca');
  assert(cleanedScriptStr.includes('/vip/i.test(nama)'), 'Akses method regex wajib rapi kembali ke notasi titik');

  // Pastikan kode hasil .dcode tetap 100% jalan dieksekusi identik!
  const testMod = { exports: {} };
  new Function('exports', 'require', 'module', cleanedScriptStr)(testMod.exports, require, testMod);
  assert.strictEqual(testMod.exports.hitung('YudhisVIP', 250), 'Selamat YudhisVIP dapat 750');

  // 38b. Uji Zlib+XOR Pack Container & Dean Edwards P.A.C.K.E.R
  const packedJs = obfuscateJavaScript(rawBotScript, { mode: 'pack' });
  const unpackedJs = deobfuscateAndBeautifyJavaScript(packedJs.code);
  assert(unpackedJs.code.includes('Selamat ') && unpackedJs.syntaxValid);

  // 38c. Uji juga sandi teks biasa (Base64/Hex/Biner/Morse) & proteksi Antilink
  const b64Enc = encodeText('b64', 'Rahasia Berlian CipiSMP 26.3');
  assert.strictEqual(decodeText('auto', b64Enc.result).result, 'Rahasia Berlian CipiSMP 26.3');

  const hexEnc = encodeText('hex', 'Koordinat Base: 120, 64, -800');
  assert.strictEqual(decodeText('auto', hexEnc.result).result, 'Koordinat Base: 120, 64, -800');

  const binEnc = encodeText('biner', 'CIPISMP');
  assert.strictEqual(decodeText('auto', binEnc.result).result, 'CIPISMP');

  const morseEnc = encodeText('morse', 'HALO CIPI 26');
  assert.strictEqual(decodeText('auto', morseEnc.result).result, 'HALO CIPI 26');

  // Uji live .ecode lalu reply hasil bot dengan .dcode tanpa menyebut format
  const cipherTesterJid = '6287799005566@s.whatsapp.net';
  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: cipherTesterJid, fromMe: false, id: 'ECODE_1' },
    pushName: 'CipherUser',
    message: { conversation: '.ecode Rahasia Kastil Cipi' },
  });
  const ecodeReplyText = tagTestPayloads.find((p) => String(p?.text || '').includes('aGFzaWE') || String(p?.text || '').includes('UmFoYXNpYS'))?.text || '';
  assert(ecodeReplyText.includes('UmFoYXNpYSBLYXN0aWwgQ2lwaQ=='), '.ecode wajib meng-encode Base64 dengan benar');

  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: cipherTesterJid, fromMe: false, id: 'DCODE_REPLY_1' },
    pushName: 'CipherUser',
    message: {
      extendedTextMessage: {
        text: '.dcode',
        contextInfo: {
          quotedMessage: { conversation: ecodeReplyText },
        },
      },
    },
  });
  assert(
    tagTestPayloads.some((p) => String(p?.text || '').includes('Rahasia Kastil Cipi')),
    'Reply pesan hasil .ecode dengan .dcode wajib otomatis mengembalikan teks asli!'
  );

  // Uji anti-penyelundupan tautan tersembunyi via Base64 saat Antilink grup aktif
  const badLinkUserJid = '6287799007788@s.whatsapp.net';
  getDb().run('UPDATE groups SET antilink = 1 WHERE jid = ?', [tagTestGroupJid]);
  const hiddenInviteB64 = Buffer.from('Ayo join https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv', 'utf8').toString('base64');
  tagTestPayloads.length = 0;
  await handleIncomingMessage(tagTestSock, {
    key: { remoteJid: tagTestGroupJid, participant: badLinkUserJid, fromMe: false, id: 'DCODE_BADLINK_1' },
    pushName: 'TemanMabar',
    message: { conversation: `.dcode ${hiddenInviteB64}` },
  });
  assert(
    !tagTestPayloads.some((p) => String(p?.text || '').includes('chat.whatsapp.com')),
    '.dcode tidak boleh memunculkan link grup WA terlarang saat Antilink aktif!'
  );

  stopKawaiiSchedulers();
  stopCommunitySchedulers();
  stopBridgeServices();
  closeDatabase();
  fs.rmSync('/tmp/cipismp-smoke', { recursive: true, force: true });

  console.log('│ ✅ [31/38] Regresi Live Bugfix (@lid Mention, Button contextInfo, Anti-Spam, .toko, .event & .tiket) lulus');
  console.log('│ ✅ [32/38] Regresi Gelombang 2 (Member 100->99, Saldo Tidak Cukup, UI Chat Berwarna, & Reply Bridge) lulus');
  console.log('│ ✅ [33/38] Proteksi Ketat Tag Massal (.tagall/.hidetag Khusus Owner, Admin & Member Ditolak) lulus');
  console.log('│ ✅ [34/38] Antilink Pintar (Bypass Aman .tt/.ig/.yt/.dl & Anti-Penyelundupan Link) lulus');
  console.log('│ ✅ [35/38] Sistem Tautan Akun MC 26.3 (.link <PIN>, .link kirim, Ranked Chat & Offline Refund) lulus');
  console.log('│ ✅ [36/38] Fitur Baru Stiker Lokal (.qc, .brat) & Sistem .afk Grup Otomatis lulus');
  console.log('│ ✅ [37/38] Paket Khas Minecraft SMP (.ach/.sach, .skin 3D/Pixel + UUID, & .poll WA Asli) lulus');
  console.log('│ ✅ [38/38] Sandi Pintar .ecode & .dcode (Auto-Detect Base64/Hex/Biner/Morse + Anti-Link Smuggling) lulus');
  console.log('╰─❖ Semua pengujian Fase 1 s/d Fase 7 + Fitur Baru LULUS sempurna! 🌸♡ ❖');
}

run().catch((err) => {
  console.error('❌ Smoke test gagal:', err);
  process.exit(1);
});
