/**
 * =====================================================================
 * ✿ E2E LIVE ROUTER TEST — SELURUH FASE 1 s/d FASE 7 (79 COMMAND) ✿
 * =====================================================================
 * Menjalankan simulasi nyata end-to-end melalui router utama `index.js`
 * (`handleIncomingMessage`, `loadFeatureModules`, `sendButtons`, Canvas,
 * SQLite, Cron/Scheduler, & Mock API) untuk memverifikasi ke-79 command
 * dieksekusi dengan reaksi `⏳ -> ✅` tanpa satu pun error `❌`.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.SESSION_DIR = '/tmp/cipismp-e2e/session';
process.env.OWNER_NUMBERS = '6281234567890';
process.env.DRY_RUN = 'true';
process.env.CIPI_DISABLE_YTDLP = '1';

const config = require('../config');
const {
  initDatabase,
  closeDatabase,
  getDb,
} = require('../lib/database');
const { addBalance } = require('../lib/economy');
const { stopBridgeServices, handleMinecraftConsoleLine } = require('../lib/bridge');
const { stopCommunitySchedulers } = require('../lib/scheduler');
const { stopKawaiiSchedulers, getActiveGameSession } = require('../lib/kawaii');
const { resetBroadcastCooldownForTest } = require('../lib/broadcast');
const {
  loadCommands,
  loadFeatureModules,
  handleIncomingMessage,
  commands,
} = require('../index');

async function runE2E() {
  console.log('╭─❖ E2E Live Router Test — Fase 1 s/d Fase 7 (79 Command) ❖');

  fs.rmSync('/tmp/cipismp-e2e', { recursive: true, force: true });
  config.paths.databaseDir = '/tmp/cipismp-e2e/db';
  config.paths.databaseFile = '/tmp/cipismp-e2e/db/cipismp.db';
  config.paths.backupsDir = '/tmp/cipismp-e2e/backups';
  config.dryRun = true;
  config.ai.apiKey = 'e2e-dummy-gemini-key';

  await initDatabase();
  loadCommands();
  loadFeatureModules();

  const mascotBuf = fs.readFileSync(path.join(config.paths.assetsDir, 'mascot.png'));
  const dummyMp4Buf = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

  // Pasang mock fetch terpadu untuk layanan eksternal (mcsrvstat, AI, TT/IG/YT, Anime)
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.mcstatus.io') || u.includes('api.mcsrvstat.us')) {
      return new Response(
        JSON.stringify({
          online: true,
          version: { name_clean: 'Paper 1.21.4' },
          players: { online: 18, max: 100, list: [{ name_clean: 'SakuraChan' }, { name_clean: '.BedrockHero' }] },
          motd: { clean: ['CipiSMP Season Sakura'] },
        }),
        { status: 200 }
      );
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Halo kak! Selamat berpetualang di CipiSMP ♡' }] } }],
        }),
        { status: 200 }
      );
    }
    if (u.includes('tikwm.com')) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            title: 'CipiSMP Base Tour',
            author: { nickname: 'SakuraBuilder' },
            play: 'https://cdn.example.com/tt.mp4',
          },
        }),
        { status: 200 }
      );
    }
    if (u.includes('ryzendesu.vip/api/downloader/igdl')) {
      return new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.example.com/ig.mp4', type: 'video' }] }),
        { status: 200 }
      );
    }
    if (u.includes('ryzendesu.vip/api/downloader/ytmp3') || u.includes('ryzendesu.vip/api/downloader/ytmp4')) {
      return new Response(
        JSON.stringify({ title: 'CipiSMP Theme', url: 'https://cdn.example.com/yt.mp4' }),
        { status: 200 }
      );
    }
    if (u.includes('api.waifu.pics')) {
      return new Response(
        JSON.stringify({ url: 'https://cdn.example.com/waifu.png' }),
        { status: 200 }
      );
    }
    if (u.includes('cdn.example.com/waifu.png')) {
      return new Response(mascotBuf, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (u.includes('cdn.example.com/')) {
      return new Response(dummyMp4Buf, { status: 200, headers: { 'content-type': 'video/mp4' } });
    }
    return new Response('{}', { status: 200 });
  };

  const ownerJid = '6281234567890@s.whatsapp.net';
  const memberJid = '6289876543210@s.whatsapp.net';
  const targetJid = '6285556667770@s.whatsapp.net';
  const botJid = '6281112223330@s.whatsapp.net';
  const groupJid = '120363044556677889@g.us';

  const sentMessages = [];
  const reactions = [];
  const groupActions = [];
  let msgSeq = 1;

  const mockSock = {
    user: { id: '6281112223330:4@s.whatsapp.net', name: 'CipiSMP Bot' },
    async sendMessage(jid, content, opts = {}) {
      if (content?.react) {
        reactions.push({ jid, emoji: content.react.text, msgId: content.react.key?.id });
        return { key: { id: `REACT-${msgSeq++}` } };
      }
      sentMessages.push({ kind: 'sendMessage', jid, content, opts });
      return { key: { remoteJid: jid, fromMe: true, id: `OUT-${msgSeq++}` } };
    },
    async relayMessage(jid, message, opts = {}) {
      sentMessages.push({ kind: 'relayMessage', jid, message, opts });
      return opts.messageId || `RELAY-${msgSeq++}`;
    },
    async waUploadToServer(_filePath, _opts = {}) {
      return {
        mediaUrl: 'https://mmg.whatsapp.net/v/t62.7118-24/mock-card.enc',
        directPath: '/v/t62.7118-24/mock-card.enc',
      };
    },
    async groupMetadata(jid) {
      return {
        id: jid,
        subject: 'Komunitas CipiSMP Official 🌸',
        participants: [
          { id: ownerJid, admin: 'superadmin' },
          { id: botJid, admin: 'admin' },
          { id: memberJid, admin: null },
          { id: targetJid, admin: null },
        ],
      };
    },
    async groupParticipantsUpdate(jid, participants, action) {
      groupActions.push({ jid, participants, action });
      return [{ status: '200', jid: participants[0] }];
    },
    async groupSettingUpdate(jid, setting) {
      groupActions.push({ jid, setting });
    },
    async profilePictureUrl() {
      return null;
    },
    async sendPresenceUpdate() {},
  };

  const executedCmdSet = new Set();

  async function dispatchCmd(cmdLine, { sender = ownerJid, inGroup = true, mentions = [], extraMsg = {} } = {}) {
    const id = `IN-${msgSeq++}`;
    const chatJid = inGroup ? groupJid : sender;
    const rawTrigger = cmdLine.trim().slice(1).split(/\s+/)[0].toLowerCase();
    const resolved = commands.get(rawTrigger);
    if (resolved) executedCmdSet.add(resolved.name);

    // Reset cooldown memory by advancing virtual spacing via owner or distinct calls
    await handleIncomingMessage(mockSock, {
      key: {
        remoteJid: chatJid,
        participant: inGroup ? sender : undefined,
        fromMe: false,
        id,
      },
      pushName: sender === ownerJid ? 'OwnerYudhis' : 'SakuraChan',
      message: {
        extendedTextMessage: {
          text: cmdLine,
          contextInfo: mentions.length > 0 ? { mentionedJid: mentions } : {},
        },
        ...extraMsg,
      },
    });

    const msgReactions = reactions.filter((r) => r.msgId === id).map((r) => r.emoji);
    assert(
      !msgReactions.includes('❌'),
      `Command "${cmdLine}" menghasilkan reaksi gagal ❌!`
    );
    assert(
      msgReactions.includes('✅'),
      `Command "${cmdLine}" tidak menghasilkan reaksi sukses ✅ (reaksi: ${msgReactions.join(',')})`
    );
  }

  try {
    // Beri modal koin cukup untuk menguji seluruh transaksi toko/gacha/transfer/giveaway/slot
    addBalance(ownerJid, 50000);
    addBalance(memberJid, 25000);

    // ===================================================================
    // FASE 1 — PONDASI, MENU, PING, OWNER, PROFIL & BACKUP DB (5 Command)
    // ===================================================================
    config.useButtons = true; // Uji mode tombol interaktif gifted-btns (relayMessage)
    await dispatchCmd('.menu');
    await dispatchCmd('.menu kawaii');
    await dispatchCmd('.ping');
    await dispatchCmd('.owner');
    await dispatchCmd('.profil');
    await dispatchCmd('.backupdb');

    // Verifikasi relayMessage terpanggil pada mode USE_BUTTONS=true + uji klik tombol interaktif & sender-lock!
    const relayPayload = sentMessages.find((m) => m.kind === 'relayMessage');
    assert(
      relayPayload,
      'gifted-btns wajib mengirim interactive message via relayMessage saat USE_BUTTONS=true'
    );
    const serializedRelay = JSON.stringify(relayPayload.message);
    const tokenMatch = /btn:[a-f0-9]+/.exec(serializedRelay);
    assert(tokenMatch, 'Tombol interaktif wajib memuat token registrasi btn:xxxx');
    const sampleBtnToken = tokenMatch[0];

    // Klik tombol oleh user lain -> harus ditolak sender-lock!
    const outBeforeWrongClick = sentMessages.length;
    await handleIncomingMessage(mockSock, {
      key: { remoteJid: groupJid, participant: memberJid, fromMe: false, id: `IN-${msgSeq++}` },
      pushName: 'SakuraChan',
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: sampleBtnToken }),
          },
        },
      },
    });
    assert(
      sentMessages.length > outBeforeWrongClick &&
        String(sentMessages.at(-1).content?.text || '').includes('ᴛᴏᴍʙᴏʟ ᴛᴇʀᴋᴜɴᴄɪ'),
      'Tombol milik pengirim lain wajib terkunci oleh sender-lock!'
    );

    // Klik tombol oleh pemilik sah -> sukses tereksekusi (✅)!
    const validClickId = `IN-${msgSeq++}`;
    await handleIncomingMessage(mockSock, {
      key: { remoteJid: groupJid, participant: ownerJid, fromMe: false, id: validClickId },
      pushName: 'OwnerYudhis',
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: sampleBtnToken }),
          },
        },
      },
    });
    assert(
      reactions.some((r) => r.msgId === validClickId && r.emoji === '✅'),
      'Klik tombol oleh pemilik sah wajib mengeksekusi command target dengan ✅'
    );

    config.useButtons = false;
    console.log('│ ✅ Fase 1 (5/5 command + gifted-btns Header Image + Klik Tombol & Sender-Lock) LULUS');

    // ===================================================================
    // FASE 2 — GRUP, EKONOMI, LEVELING & STIKER (20 Command)
    // ===================================================================
    await dispatchCmd('.welcome on');
    await dispatchCmd('.welcome test');
    await dispatchCmd('.antilink on');
    await dispatchCmd('.antispam on');
    await dispatchCmd('.tagall Kumpul event malam ini!');
    await dispatchCmd('.hidetag Pengumuman halus');
    await dispatchCmd('.promote @6285556667770', { mentions: [targetJid] });
    await dispatchCmd('.demote @6285556667770', { mentions: [targetJid] });
    await dispatchCmd('.kick @6285556667770', { mentions: [targetJid] });
    await dispatchCmd('.tutup');
    await dispatchCmd('.buka');
    await dispatchCmd('.mute on');
    await dispatchCmd('.mute off');

    await dispatchCmd('.saldo');
    await dispatchCmd('.daily');
    await dispatchCmd('.weekly');
    await dispatchCmd('.kerja');
    await dispatchCmd('.transfer @6289876543210 250', { mentions: [memberJid] });
    await dispatchCmd('.leaderboard saldo');
    await dispatchCmd('.level');

    // Stiker, QC, Brat, AFK, Achievement, Skin, Poll & ToImg
    await dispatchCmd('.sticker');
    await dispatchCmd('.toimg');
    await dispatchCmd('.qc Lagi nambang diamond di CipiSMP!');
    await dispatchCmd('.brat hijau cipi smp paling asik');
    await dispatchCmd('.ach Dapat Full Netherite!');
    await dispatchCmd('.skin YudhisCipi');
    await dispatchCmd('.poll Event malam ini? | PvP Arena | Parkour | Boss Fight');
    await dispatchCmd('.afk Lagi nambang netherite sebentar', { sender: memberJid });
    console.log('│ ✅ Fase 2 (26/26 command Grup, AFK, Poll, Ekonomi, Level, Stiker, .qc, .brat, .ach & .skin) LULUS');

    // ===================================================================
    // FASE 3 — MINECRAFT CARD, AI, DOWNLOADER, ANIME & BROADCAST (13 Command)
    // ===================================================================
    await dispatchCmd('.server');
    await dispatchCmd('.ai Apa tips survival hari pertama di CipiSMP?');
    await dispatchCmd('.tiktok https://vt.tiktok.com/ZSY12345/');
    await dispatchCmd('.ig https://www.instagram.com/reel/C12345/');
    await dispatchCmd('.yt https://youtu.be/dQw4w9WgXcQ');
    await dispatchCmd('.dl https://vt.tiktok.com/ZSY12345/');
    await dispatchCmd('.anime neko');

    resetBroadcastCooldownForTest();
    await dispatchCmd('.bc Halo warga WhatsApp!');
    await dispatchCmd('.batal');
    await dispatchCmd('.bcmc Halo pemain Minecraft!');
    await dispatchCmd('.batal');
    await dispatchCmd('.bcdc Halo warga Discord!');
    await dispatchCmd('.batal');
    await dispatchCmd('.bcall Pengumuman serentak CipiSMP!');
    await dispatchCmd('.ya');
    console.log('│ ✅ Fase 3 (13/13 command Server, AI, Downloader, Anime & Broadcast) LULUS');

    // ===================================================================
    // FASE 4 — BRIDGE 2 ARAH, TAUTAN GEYSER/JAVA & PTERODACTYL (10 Command)
    // ===================================================================
    await dispatchCmd('.bridge on');
    await dispatchCmd('.link SakuraJava');
    const pendingRow = getDb().get('SELECT verify_code FROM links WHERE jid = ?', [ownerJid]);
    await handleMinecraftConsoleLine(
      `[16:00:00 INFO]: <SakuraJava>Verifikasi saya ${pendingRow.verify_code}`
    );
    await dispatchCmd('.akun');
    await dispatchCmd('.tukar roti_kit');
    await dispatchCmd('.unlink');

    await dispatchCmd('.start');
    await dispatchCmd('.stop');
    await dispatchCmd('.batal');
    await dispatchCmd('.restart');
    await dispatchCmd('.batal');
    await dispatchCmd('.backup e2e-snap');
    await dispatchCmd('.console list');
    console.log('│ ✅ Fase 4 (10/10 command Bridge, Link MC & Kontrol Pterodactyl) LULUS');

    // ===================================================================
    // FASE 5 — GIVEAWAY, EVENT CRON WIB, TIKET DISCORD, TOPSERVER & QUEST (7 Command)
    // ===================================================================
    await dispatchCmd('.giveaway buat 10m | 1 | 500 | 500 Sakura Coin Spesial');
    await dispatchCmd('.ikut', { sender: memberJid });
    const activeGw = getDb().get("SELECT code FROM giveaways WHERE status = 'active' LIMIT 1");
    await dispatchCmd(`.giveaway end ${activeGw.code}`);

    await dispatchCmd('.event tambah mingguan sabtu 20:00 | Malam Keakraban | Kumpul di Spawn!');
    const activeEv = getDb().get('SELECT code FROM events LIMIT 1');
    await dispatchCmd(`.event hapus ${activeEv.code}`);

    await dispatchCmd('.lapor bug | Pintu rumahku nyangkut di spawn');
    const activeTkt = getDb().get('SELECT ticket_no FROM tickets ORDER BY id DESC LIMIT 1');
    await dispatchCmd(`.tiket tutup ${activeTkt.ticket_no} Sudah diperbaiki ya!`);

    await dispatchCmd('.topserver playtime');
    await dispatchCmd('.quest');
    console.log('│ ✅ Fase 5 (7/7 command Giveaway, Event WIB, Tiket, TopServer & Quest) LULUS');

    // ===================================================================
    // FASE 6 — GACHA WAIFU, PET VIRTUAL, TOKO PROFIL, ULTAH & 6 GAME FUN (11 Command)
    // ===================================================================
    await dispatchCmd('.gacha 1');
    await dispatchCmd('.gacha 10');
    await dispatchCmd('.koleksi');
    await dispatchCmd('.pet adopsi kitsune Koharu');
    await dispatchCmd('.pet main');
    await dispatchCmd('.toko beli bg_sunset');
    await dispatchCmd('.ultah set 14-02');

    // Uji .kuis + jawab langsung di chat tanpa prefix!
    await dispatchCmd('.kuis');
    const activeQuiz = getActiveGameSession(groupJid);
    assert(activeQuiz && activeQuiz.type === 'kuis');
    const balBeforeQuiz = getDb().get('SELECT balance FROM economy WHERE jid = ?', [memberJid]).balance;
    await handleIncomingMessage(mockSock, {
      key: { remoteJid: groupJid, participant: memberJid, fromMe: false, id: `IN-${msgSeq++}` },
      pushName: 'SakuraChan',
      message: { conversation: activeQuiz.answers[0] },
    });
    const balAfterQuiz = getDb().get('SELECT balance FROM economy WHERE jid = ?', [memberJid]).balance;
    assert.strictEqual(balAfterQuiz, balBeforeQuiz + activeQuiz.rewardCoins);

    // Uji .tebakgambar + jawab langsung di chat tanpa prefix!
    await dispatchCmd('.tebakgambar');
    const activeTg = getActiveGameSession(groupJid);
    assert(activeTg && activeTg.type === 'tebakgambar');
    await handleIncomingMessage(mockSock, {
      key: { remoteJid: groupJid, participant: memberJid, fromMe: false, id: `IN-${msgSeq++}` },
      pushName: 'SakuraChan',
      message: { conversation: activeTg.answers[0] },
    });
    assert.strictEqual(getActiveGameSession(groupJid), null);

    await dispatchCmd('.ramalan');
    await dispatchCmd('.quotes');
    await dispatchCmd('.suit batu 100');
    await dispatchCmd('.slot 100');
    console.log('│ ✅ Fase 6 (11/11 command Gacha, Pet, Toko, Ultah & 6 Game Fun) LULUS');

    // ===================================================================
    // FASE 7 — MANAJEMEN OWNER LENGKAP, SAKURA VIP, SANDBOX EVAL & LOGS (13 Command)
    // ===================================================================
    await dispatchCmd('.addprem 6289876543210 30d Hadiah E2E');
    await dispatchCmd('.listprem');
    await dispatchCmd('.vip', { sender: memberJid });
    await dispatchCmd('.delprem 6289876543210');

    await dispatchCmd('.ban 6285556667770 Uji E2E Ban');
    await dispatchCmd('.banlist');
    await dispatchCmd('.unban 6285556667770');

    await dispatchCmd('.self');
    await dispatchCmd('.public');
    await dispatchCmd('.maintenance on Perawatan singkat E2E ♡');
    await dispatchCmd('.maintenance off');

    config.enableOwnerEval = true;
    await dispatchCmd('.eval stats().commandsCount');
    config.enableOwnerEval = false;

    await dispatchCmd('.logs 5');
    await dispatchCmd('.restartbot reload');
    await dispatchCmd('.restartbot');
    console.log('│ ✅ Fase 7 (13/13 command Ban, Self/Public, Maintenance, VIP, Eval, Logs & Restart) LULUS');

    // ===================================================================
    // VERIFIKASI 100% CAKUPAN SELURUH 79 COMMAND UTAMA
    // ===================================================================
    const allRegisteredNames = [...commands.keys()];
    const missed = allRegisteredNames.filter((n) => !executedCmdSet.has(n));
    assert.strictEqual(
      missed.length,
      0,
      `Masih ada command yang belum teruji E2E: ${missed.join(', ')}`
    );

    console.log(`│ 🎯 CAKUPAN E2E: ${executedCmdSet.size}/${allRegisteredNames.length} Command Utama (100%) dieksekusi dengan reaksi ✅!`);
    console.log(`│ 📨 Total Pesan & Kartu Terkirim Simulasi: ${sentMessages.length} payload | Reaksi: ${reactions.length}`);
    console.log('╰─❖ SELURUH FASE 1 s/d FASE 7 TERUJI LIVE END-TO-END TANPA ERROR! 🌸♡ ❖');
  } finally {
    global.fetch = originalFetch;
    stopKawaiiSchedulers();
    stopCommunitySchedulers();
    stopBridgeServices();
    closeDatabase();
    fs.rmSync('/tmp/cipismp-e2e', { recursive: true, force: true });
  }
}

runE2E().catch((err) => {
  console.error('❌ E2E Live Test gagal:', err);
  process.exit(1);
});
