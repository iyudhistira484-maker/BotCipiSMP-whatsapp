const net = require('net');
const WebSocket = require('ws');
const config = require('../config');
const { fetchWithTimeout } = require('./api');
const { normalizeMinecraftUsername } = require('./database');
const { logger } = require('./logger');

/**
 * Bersihkan ANSI escape codes & kode warna § dari baris log console Pterodactyl
 */
function stripAnsiAndMcCodes(rawLine = '') {
  return String(rawLine || '')
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/§[0-9A-FK-ORX]/gi, '')
    .replace(/[\r\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Sanitasi teks tujuan Minecraft:
 * - Cegah injeksi command (hapus garis miring "/" di awal, karakter kontrol, baris baru)
 * - Hapus kode format § liar & selector @e/@a berbahaya
 * - Batasi maksimal karakter
 */
function sanitizeMinecraftText(raw = '', maxLen = 300) {
  return String(raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/§[0-9A-FK-ORX]/gi, '')
    .replace(/^\/+/, '')
    .replace(/@([aeprs])\b/gi, '@\u200b$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Bungkus nama pemain Minecraft secara aman untuk argumen command (mendukung nama Bedrock berspasi/awalan titik)
 */
function formatSafeMcTarget(mcUsername = '') {
  const check = normalizeMinecraftUsername(mcUsername);
  if (!check.valid) {
    throw new Error(`Username Minecraft tidak valid: ${mcUsername}`);
  }
  if (check.display.includes(' ')) {
    return `"${check.display}"`;
  }
  return check.display;
}

/**
 * Bersihkan prefix timestamp/thread & prefix Minecraft 26.3 ("System chat:") dari log console
 */
function stripMcLogTimestamp(cleanLine = '') {
  return String(cleanLine || '')
    .replace(/^\[?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?\s*(?:\[[^\]]*?(?:INFO|WARN|ERROR)\]:\s*|INFO\]:\s*|WARN\]:\s*|ERROR\]:\s*)?/i, '')
    .replace(/^\[?\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\]]*\]\s*(?:INFO|WARN|ERROR)?\s*/i, '')
    .replace(/^System chat:\s*/i, '')
    .replace(/^\[Not Secure\]\s*/i, '')
    .replace(/^>\s*/, '')
    .trim();
}

// Listener sementara untuk menangkap output command langsung dari stream WebSocket Wings
const wsOutputListeners = new Set();
// Mode broadcast adaptif: 'java' | 'bukkit_ns' (minecraft:tellraw) | 'bedrock' | 'say'
let detectedBroadcastFormat = 'java';

function isConsoleCommandSyntaxError(line = '') {
  return /Unknown or incomplete command|Unknown command|Incorrect argument for command|Invalid chat component|Can't insert compound|Syntax error|Unexpected token|<--\[HERE\]/i.test(
    String(line || '')
  );
}

/**
 * Bangun perintah tellraw aman berbasis Compound tunggal + extra homogen (murni ASCII di tag agar aman di Docker stdin):
 * Kompatibel penuh dengan Minecraft Java 26.x (26.1/26.2/26.3 SNBT), 1.21.5+, maupun 1.8–1.21.4 (JSON)!
 */
function buildTellrawBroadcastCommand(cleanMessage, prefixTag = 'CipiSMP') {
  const safeTag = sanitizeMinecraftText(prefixTag.replace(/[^\x20-\x7E]/g, '').trim() || 'CipiSMP', 24);
  const safeMsg = sanitizeMinecraftText(cleanMessage, 300);
  const payload = {
    text: '',
    extra: [
      { text: '[', color: 'dark_gray' },
      { text: safeTag, color: 'light_purple', bold: true },
      { text: '] ', color: 'dark_gray' },
      { text: safeMsg, color: 'white' },
    ],
  };
  return `tellraw @a ${JSON.stringify(payload)}`;
}

/**
 * Bangun perintah tellraw khusus Bedrock Dedicated Server (rawtext)
 */
function buildBedrockBroadcastCommand(cleanMessage, prefixTag = 'CipiSMP') {
  const safeTag = sanitizeMinecraftText(prefixTag.replace(/[^\x20-\x7E]/g, '').trim() || 'CipiSMP', 24);
  const safeMsg = sanitizeMinecraftText(cleanMessage, 300);
  const payload = {
    rawtext: [{ text: `§8[§d${safeTag}§8] §f${safeMsg}` }],
  };
  return `tellraw @a ${JSON.stringify(payload)}`;
}

/**
 * Bangun perintah say sederhana sebagai cadangan universal (tampil di In-Game Chat + Console Pterodactyl)
 */
function buildSayBroadcastCommand(cleanMessage, prefixTag = 'CipiSMP') {
  const safeTag = sanitizeMinecraftText(prefixTag.replace(/[^\x20-\x7E]/g, '').trim() || 'CipiSMP', 24);
  return `say [${safeTag}] ${sanitizeMinecraftText(cleanMessage, 300)}`;
}

/**
 * Bangun perintah tellraw untuk Bridge Chat 2 arah ([WA] / [DC] -> Minecraft)
 */
function buildBridgeTellrawCommand({
  sourceTag = 'WA',
  sourceColor = 'green',
  senderName = 'Member',
  message = '',
}) {
  const safeSender = sanitizeMinecraftText(senderName, 32) || 'Member';
  const safeMsg = sanitizeMinecraftText(
    message,
    config.bridge?.maxMessageLength || 220
  );
  const payload = {
    text: '',
    extra: [
      { text: '[', color: 'dark_gray' },
      { text: sourceTag, color: sourceColor, bold: true },
      { text: '] ', color: 'dark_gray' },
      { text: `${safeSender}`, color: 'light_purple' },
      { text: ': ', color: 'gray' },
      { text: safeMsg, color: 'white' },
    ],
  };
  const colorCode = sourceColor === 'aqua' ? '§b' : '§a';
  const bedrockPayload = {
    rawtext: [{ text: `§8[${colorCode}${sourceTag}§8] §d${safeSender}§7: §f${safeMsg}` }],
  };
  return {
    tellraw: `tellraw @a ${JSON.stringify(payload)}`,
    bedrock: `tellraw @a ${JSON.stringify(bedrockPayload)}`,
    say: `say [${sourceTag}] ${safeSender}: ${safeMsg}`,
  };
}

/**
 * Cek apakah konfigurasi Pterodactyl Client API sudah lengkap
 */
function isPteroConfigured() {
  return Boolean(
    config.pterodactyl.panelUrl &&
      config.pterodactyl.clientApiKey &&
      config.pterodactyl.serverId
  );
}

/**
 * Cek apakah konfigurasi RCON sudah lengkap
 */
function isRconConfigured() {
  return Boolean(
    config.rcon.host &&
      config.rcon.port &&
      config.rcon.password
  );
}

/**
 * Panggilan HTTP generik ke Pterodactyl Client API v1
 */
async function pteroRequest(subPath, { method = 'GET', body = undefined } = {}) {
  if (!isPteroConfigured()) {
    throw new Error('Pterodactyl API belum dikonfigurasi di .env');
  }

  const base = config.pterodactyl.panelUrl.replace(/\/+$/, '');
  const srv = encodeURIComponent(config.pterodactyl.serverId);
  const url = `${base}/api/client/servers/${srv}${subPath}`;

  const headers = {
    Accept: 'Application/vnd.pterodactyl.v1+json',
    Authorization: `Bearer ${config.pterodactyl.clientApiKey}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    config.pterodactyl.timeoutMs || 10000
  );

  // Endpoint /command dan /power mengembalikan 204 No Content saat sukses
  if (res.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const detail =
      json?.errors?.[0]?.detail || json?.message || `HTTP ${res.status}`;
    throw new Error(`Pterodactyl API: ${detail}`);
  }

  return { ok: true, status: res.status, data: json };
}

/**
 * Kirim satu baris perintah ke console server via Pterodactyl Client API.
 * Bila captureOutput=true dan stream WebSocket Wings sedang aktif, tangkap baris balasan console secara real-time.
 */
async function sendPteroCommand(
  command,
  { captureOutput = false, captureMs = 1100, settleMs = 260 } = {}
) {
  const cleanCmd = String(command || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\/+/, '')
    .trim();

  if (!cleanCmd) {
    throw new Error('Perintah console kosong');
  }

  const canCaptureWs = Boolean(
    captureOutput && wsClient && wsClient.readyState === WebSocket.OPEN
  );

  if (!canCaptureWs) {
    await pteroRequest('/command', {
      method: 'POST',
      body: { command: cleanCmd },
    });
    return { ok: true, via: 'pterodactyl', response: '' };
  }

  const collected = [];
  const rawLines = [];
  let settleTimer = null;
  let maxTimer = null;
  let resolveWait = null;

  const finishCapture = () => {
    wsOutputListeners.delete(onLine);
    if (settleTimer) clearTimeout(settleTimer);
    if (maxTimer) clearTimeout(maxTimer);
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r();
    }
  };

  function onLine(cleanLine) {
    const stripped = stripMcLogTimestamp(cleanLine);
    if (!stripped) return;
    // Abaikan pantulan persis dari baris input command itu sendiri
    if (
      stripped === cleanCmd ||
      stripped === `/${cleanCmd}` ||
      cleanLine.trim() === cleanCmd
    ) {
      return;
    }
    rawLines.push(cleanLine);
    collected.push(stripped);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(finishCapture, settleMs);
  }

  const waitPromise = new Promise((resolve) => {
    resolveWait = resolve;
    maxTimer = setTimeout(finishCapture, captureMs);
  });

  wsOutputListeners.add(onLine);
  try {
    await pteroRequest('/command', {
      method: 'POST',
      body: { command: cleanCmd },
    });
    await waitPromise;
  } catch (err) {
    finishCapture();
    throw err;
  }

  return {
    ok: true,
    via: 'Pterodactyl Console',
    response: collected.join('\n').trim(),
    rawLines,
  };
}

/**
 * Implementasi klien TCP Source RCON murni (tanpa dependensi eksternal)
 * Digunakan sebagai fallback otomatis apabila Pterodactyl API gagal/tidak diatur
 */
function sendRconCommand(command) {
  return new Promise((resolve, reject) => {
    if (!isRconConfigured()) {
      reject(new Error('RCON belum dikonfigurasi di .env (RCON_PASSWORD kosong)'));
      return;
    }

    const cleanCmd = String(command || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/^\/+/, '')
      .trim();

    const socket = new net.Socket();
    const timeoutMs = Number(config.rcon.timeoutMs || 8000);
    let settled = false;
    let incomingBuffer = Buffer.alloc(0);

    const AUTH_ID = 0x101;
    const CMD_ID = 0x102;
    const SERVERDATA_AUTH = 3;
    const SERVERDATA_EXECCOMMAND = 2;

    const encodePacket = (id, type, bodyStr) => {
      const bodyBuf = Buffer.from(bodyStr, 'utf8');
      const length = 4 + 4 + bodyBuf.length + 2;
      const packet = Buffer.alloc(4 + length);
      packet.writeInt32LE(length, 0);
      packet.writeInt32LE(id, 4);
      packet.writeInt32LE(type, 8);
      bodyBuf.copy(packet, 12);
      packet.writeInt16LE(0, 12 + bodyBuf.length);
      return packet;
    };

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // Abaikan
      }
      if (err) reject(err);
      else resolve(result);
    };

    socket.setTimeout(timeoutMs, () => {
      finish(new Error('Koneksi RCON timeout'));
    });

    socket.on('error', (err) => {
      finish(new Error(`RCON socket error: ${err.message}`));
    });

    let authenticated = false;

    socket.on('data', (chunk) => {
      incomingBuffer = Buffer.concat([incomingBuffer, chunk]);

      while (incomingBuffer.length >= 4) {
        const pktLen = incomingBuffer.readInt32LE(0);
        if (pktLen < 10 || pktLen > 65536) {
          finish(new Error('Paket RCON tidak valid'));
          return;
        }
        if (incomingBuffer.length < 4 + pktLen) {
          break;
        }

        const pkt = incomingBuffer.subarray(4, 4 + pktLen);
        incomingBuffer = incomingBuffer.subarray(4 + pktLen);

        const reqId = pkt.readInt32LE(0);
        const body = pkt.subarray(8, pkt.length - 2).toString('utf8');

        if (!authenticated) {
          if (reqId === -1) {
            finish(new Error('Autentikasi password RCON ditolak'));
            return;
          }
          if (reqId === AUTH_ID) {
            authenticated = true;
            socket.write(encodePacket(CMD_ID, SERVERDATA_EXECCOMMAND, cleanCmd));
          }
        } else if (reqId === CMD_ID) {
          finish(null, { ok: true, via: 'rcon', response: stripAnsiAndMcCodes(body) });
          return;
        }
      }
    });

    socket.connect(Number(config.rcon.port), config.rcon.host, () => {
      socket.write(encodePacket(AUTH_ID, SERVERDATA_AUTH, config.rcon.password));
    });
  });
}

/**
 * Eksekusi satu command Minecraft via Pterodactyl -> Fallback RCON
 * Menghormati config.dryRun = true
 */
async function executeMinecraftCommand(rawCommand, { preferRconForOutput = false } = {}) {
  const cleanCmd = String(rawCommand || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\/+/, '')
    .trim();

  if (!cleanCmd) {
    return { ok: false, via: 'none', error: 'Perintah kosong' };
  }

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      via: 'dry-run',
      command: cleanCmd,
      response: `[DRY-RUN] Simulasi eksekusi: ${cleanCmd}`,
    };
  }

  const errors = [];

  // Jika butuh output teks balasan (misal .console list/tps) dan RCON tersedia, coba RCON dulu agar balasan langsung terbaca
  if (preferRconForOutput && isRconConfigured()) {
    try {
      const rconRes = await sendRconCommand(cleanCmd);
      return { ok: true, via: 'RCON', response: rconRes.response || '' };
    } catch (err) {
      errors.push(`RCON: ${err.message}`);
    }
  }

  if (isPteroConfigured()) {
    try {
      const pteroRes = await sendPteroCommand(cleanCmd, {
        captureOutput: Boolean(preferRconForOutput),
        captureMs: 1200,
        settleMs: 280,
      });
      return {
        ok: true,
        via: pteroRes.via || 'Pterodactyl API',
        response: pteroRes.response || '',
      };
    } catch (err) {
      errors.push(`Pterodactyl: ${err.message}`);
    }
  } else {
    errors.push('Pterodactyl belum diatur');
  }

  if (!preferRconForOutput && isRconConfigured()) {
    try {
      const rconRes = await sendRconCommand(cleanCmd);
      return { ok: true, via: 'RCON', response: rconRes.response || '' };
    } catch (err) {
      errors.push(`RCON: ${err.message}`);
    }
  } else if (!isRconConfigured()) {
    errors.push('RCON belum diatur');
  }

  return {
    ok: false,
    via: 'none',
    error: errors.join(' | '),
  };
}

async function sendAdaptivePteroChat({ javaTellraw, bedrockTellraw, sayFallback }) {
  const bukkitTellraw = javaTellraw.replace(/^tellraw\s+/i, 'minecraft:tellraw ');

  if (detectedBroadcastFormat === 'bukkit_ns') {
    const nsRes = await sendPteroCommand(bukkitTellraw, { captureOutput: true, captureMs: 500, settleMs: 180 });
    if (!isConsoleCommandSyntaxError(nsRes.response)) {
      return {
        ok: true,
        via: 'Pterodactyl (minecraft:tellraw)',
        noPlayersOnline: /No player was found/i.test(nsRes.response || ''),
        consoleOutput: nsRes.response || '',
      };
    }
    detectedBroadcastFormat = 'say';
  }

  if (detectedBroadcastFormat === 'bedrock' && bedrockTellraw) {
    const res = await sendPteroCommand(bedrockTellraw, { captureOutput: true, captureMs: 500, settleMs: 180 });
    if (!isConsoleCommandSyntaxError(res.response)) {
      return {
        ok: true,
        via: 'Pterodactyl (tellraw-bedrock)',
        consoleOutput: res.response || '',
      };
    }
    detectedBroadcastFormat = 'say';
  }

  if (detectedBroadcastFormat === 'say') {
    const sayRes = await sendPteroCommand(sayFallback, { captureOutput: true, captureMs: 500, settleMs: 180 });
    return {
      ok: true,
      via: 'Pterodactyl (say)',
      consoleOutput: sayRes.response || '',
    };
  }

  // Tahap 1: Java Compound Tellraw (MC 26.3 SNBT / 1.21.5+ / 1.8+)
  const res = await sendPteroCommand(javaTellraw, {
    captureOutput: true,
    captureMs: 550,
    settleMs: 200,
  });

  if (res.response && isConsoleCommandSyntaxError(res.response)) {
    // Tahap 2: Bila plugin Paper/Purpur menimpa/memblokir alias "tellraw", coba namespace "minecraft:tellraw"
    if (/Unknown or incomplete command|Unknown command/i.test(res.response)) {
      const nsRes = await sendPteroCommand(bukkitTellraw, {
        captureOutput: true,
        captureMs: 500,
        settleMs: 180,
      });
      if (!isConsoleCommandSyntaxError(nsRes.response)) {
        detectedBroadcastFormat = 'bukkit_ns';
        logger.info('PTERO', 'Menggunakan namespace minecraft:tellraw pada server Paper/Purpur 26.3');
        return {
          ok: true,
          via: 'Pterodactyl (minecraft:tellraw)',
          noPlayersOnline: /No player was found/i.test(nsRes.response || ''),
          consoleOutput: nsRes.response || '',
        };
      }
    }

    // Tahap 3: Bila server adalah Bedrock Dedicated Server
    if (/Syntax error:\s*Unexpected/i.test(res.response) && bedrockTellraw) {
      detectedBroadcastFormat = 'bedrock';
      logger.warn('PTERO', 'Server menolak Java tellraw, beralih otomatis ke format Bedrock rawtext');
      const bdRes = await sendPteroCommand(bedrockTellraw, { captureOutput: true, captureMs: 450, settleMs: 180 });
      if (!isConsoleCommandSyntaxError(bdRes.response)) {
        return {
          ok: true,
          via: 'Pterodactyl (tellraw-bedrock)',
          consoleOutput: bdRes.response || '',
        };
      }
    }

    // Tahap 4: Fallback universal "say" (dijamin jalan di semua server & tampil di Console + In-Game!)
    detectedBroadcastFormat = 'say';
    logger.warn('PTERO', 'Server menolak tellraw, beralih otomatis ke perintah say bersih');
    const sayRes = await sendPteroCommand(sayFallback, { captureOutput: true, captureMs: 500, settleMs: 180 });
    return {
      ok: true,
      via: 'Pterodactyl (say)',
      consoleOutput: sayRes.response || '',
    };
  }

  const noPlayersOnline = /No player was found/i.test(res.response || '');
  return {
    ok: true,
    via: 'Pterodactyl (tellraw 26.3)',
    noPlayersOnline,
    consoleOutput: res.response || '',
  };
}

/**
 * Kirim pengumuman/perintah ke Minecraft:
 * Urutan: Pterodactyl (tellraw compound -> auto-fallback bedrock/say) -> Fallback RCON
 * Menghormati config.dryRun = true
 */
async function sendMinecraftBroadcast(rawMessage, prefixLabel = '✿ Pengumuman') {
  const cleanMsg = sanitizeMinecraftText(rawMessage, config.broadcast?.maxLength || 300);
  if (!cleanMsg) {
    return { ok: false, via: 'none', error: 'Pesan kosong setelah sanitasi' };
  }

  const tellrawCmd = buildTellrawBroadcastCommand(cleanMsg, prefixLabel);
  const bedrockCmd = buildBedrockBroadcastCommand(cleanMsg, prefixLabel);
  const sayCmd = buildSayBroadcastCommand(cleanMsg, prefixLabel);

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      via: 'dry-run',
      commandPreview: tellrawCmd,
    };
  }

  const errors = [];

  if (isPteroConfigured()) {
    try {
      return await sendAdaptivePteroChat({
        javaTellraw: tellrawCmd,
        bedrockTellraw: bedrockCmd,
        sayFallback: sayCmd,
      });
    } catch (errTellraw) {
      errors.push(`Ptero tellraw: ${errTellraw.message}`);
      try {
        await sendPteroCommand(sayCmd);
        return { ok: true, via: 'Pterodactyl (say)' };
      } catch (errSay) {
        errors.push(`Ptero say: ${errSay.message}`);
        logger.warn('PTERO', `Broadcast Pterodactyl gagal (${errSay.message}), mencoba fallback RCON...`);
      }
    }
  } else {
    errors.push('Pterodactyl API belum diisi');
  }

  if (isRconConfigured()) {
    try {
      const rconRes = await sendRconCommand(tellrawCmd);
      if (rconRes.response && isConsoleCommandSyntaxError(rconRes.response)) {
        await sendRconCommand(sayCmd);
        return { ok: true, via: 'RCON (say)' };
      }
      return { ok: true, via: 'RCON (tellraw)' };
    } catch (errRconTellraw) {
      errors.push(`RCON tellraw: ${errRconTellraw.message}`);
      try {
        await sendRconCommand(sayCmd);
        return { ok: true, via: 'RCON (say)' };
      } catch (errRconSay) {
        errors.push(`RCON say: ${errRconSay.message}`);
      }
    }
  } else {
    errors.push('RCON belum diisi');
  }

  return {
    ok: false,
    via: 'none',
    error: errors.join(' | '),
  };
}

/**
 * Kirim pesan chat bridge dari WhatsApp / Discord ke layar chat Minecraft
 */
async function sendMinecraftBridgeChat({
  sourceTag = 'WA',
  sourceColor = 'green',
  senderName = 'Member',
  message = '',
}) {
  const cmds = buildBridgeTellrawCommand({
    sourceTag,
    sourceColor,
    senderName,
    message,
  });

  if (config.dryRun) {
    return { ok: true, dryRun: true, via: 'dry-run', command: cmds.tellraw };
  }

  if (isPteroConfigured()) {
    try {
      return await sendAdaptivePteroChat({
        javaTellraw: cmds.tellraw,
        bedrockTellraw: cmds.bedrock,
        sayFallback: cmds.say,
      });
    } catch {
      // Lanjut fallback
    }
  }

  const primary = await executeMinecraftCommand(cmds.tellraw);
  if (primary.ok) return primary;

  return executeMinecraftCommand(cmds.say);
}

/**
 * Bisikkan pesan privat ke pemain di dalam Minecraft (misal petunjuk kode .link)
 */
async function whisperMinecraftPlayer(mcUsername, message) {
  const safeTarget = formatSafeMcTarget(mcUsername);
  const safeMsg = sanitizeMinecraftText(message, 220);
  if (!safeMsg) return { ok: false, error: 'Pesan kosong' };
  return executeMinecraftCommand(`tell ${safeTarget} ${safeMsg}`);
}

/**
 * Validasi ketat daftar putih (whitelist) untuk command .console khusus Owner
 */
function validateWhitelistedConsoleCommand(rawInput = '') {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return { allowed: false, reason: 'empty' };
  }

  // Tolak karakter berbahaya / chaining / newline / selector massal
  if (/[\r\n\x00-\x1F\x7F;|`$&]/.test(raw) || /@[ae]\b/i.test(raw)) {
    return {
      allowed: false,
      reason: 'forbidden_chars',
      detail: 'Mengandung karakter kontrol, chaining (; / & / |), atau selector @a/@e terlarang.',
    };
  }

  const clean = raw.replace(/^\/+/, '').replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();

  // 1. Cek kecocokan persis dengan daftar whitelist
  const exactList = (config.minecraft.consoleWhitelist || []).map((c) =>
    c.toLowerCase().trim()
  );
  if (exactList.includes(lower)) {
    return { allowed: true, cleanCommand: clean };
  }

  // 2. Cek prefix berparameter yang diizinkan secara aman (say, whitelist add/remove)
  if (lower.startsWith('say ')) {
    const msgBody = sanitizeMinecraftText(clean.slice(4), 240);
    if (!msgBody) {
      return { allowed: false, reason: 'empty_arg', detail: 'Pesan say kosong.' };
    }
    return { allowed: true, cleanCommand: `say ${msgBody}` };
  }

  if (lower.startsWith('whitelist add ') || lower.startsWith('whitelist remove ')) {
    const isAdd = lower.startsWith('whitelist add ');
    const rawUser = clean.slice(isAdd ? 'whitelist add '.length : 'whitelist remove '.length).trim();
    const parsedUser = normalizeMinecraftUsername(rawUser);
    if (!parsedUser.valid) {
      return {
        allowed: false,
        reason: 'invalid_player',
        detail: 'Format username Minecraft pada perintah whitelist tidak valid.',
      };
    }
    const targetArg = parsedUser.display.includes(' ')
      ? `"${parsedUser.display}"`
      : parsedUser.display;
    return {
      allowed: true,
      cleanCommand: `whitelist ${isAdd ? 'add' : 'remove'} ${targetArg}`,
    };
  }

  return {
    allowed: false,
    reason: 'not_whitelisted',
    detail: `Perintah "${clean.split(' ')[0]}" tidak ada di dalam daftar putih (whitelist) keamanan.`,
  };
}

/**
 * Kontrol Resource, Power & Backup Server Pterodactyl (Fase 4)
 */
async function getServerResources() {
  const res = await pteroRequest('/resources', { method: 'GET' });
  return res.data?.attributes || null;
}

async function sendPowerSignal(signal) {
  const allowed = ['start', 'stop', 'restart', 'kill'];
  if (!allowed.includes(signal)) {
    throw new Error(`Sinyal power tidak valid: ${signal}`);
  }
  if (config.dryRun) {
    return { ok: true, dryRun: true, signal };
  }
  await pteroRequest('/power', {
    method: 'POST',
    body: { signal },
  });
  return { ok: true, dryRun: false, signal };
}

async function listPteroBackups() {
  const res = await pteroRequest('/backups', { method: 'GET' });
  const items = Array.isArray(res.data?.data)
    ? res.data.data.map((d) => d.attributes).filter(Boolean)
    : [];
  return items;
}

async function createPteroServerBackup(name = '') {
  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      backup: {
        uuid: 'dryrun-uuid-0000',
        name: name || 'cipismp-dryrun-backup',
        bytes: 0,
      },
    };
  }
  const res = await pteroRequest('/backups', {
    method: 'POST',
    body: name ? { name: sanitizeMinecraftText(name, 60) } : {},
  });
  return { ok: true, dryRun: false, backup: res.data?.attributes || null };
}

async function getPteroWebsocketCredentials() {
  const res = await pteroRequest('/websocket', { method: 'GET' });
  return res.data?.data || null;
}

// =====================================================================
// PTERODACTYL WINGS WEBSOCKET CONSOLE & STATUS STREAM (24/7 AUTO-RECONNECT)
// =====================================================================

let wsClient = null;
let wsReconnectTimer = null;
let wsStoppedManually = true;
let wsReconnectAttempt = 0;
let lastKnownServerState = 'unknown';

function getPteroStreamState() {
  return {
    connected: Boolean(wsClient && wsClient.readyState === WebSocket.OPEN),
    serverState: lastKnownServerState,
  };
}

/**
 * Mulai koneksi WebSocket real-time ke Pterodactyl Wings untuk membaca chat in-game,
 * join/leave pemain, kode verifikasi .link, dan perubahan status server nyala/mati.
 */
async function startPteroConsoleStream({
  onConsoleLine,
  onStatusChange,
} = {}) {
  if (!isPteroConfigured()) {
    logger.info('PTERO:WS', 'Pterodactyl API belum diisi — stream WebSocket console dilewati (mode fallback aktif)');
    return { started: false, reason: 'unconfigured' };
  }

  wsStoppedManually = false;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  const scheduleReconnect = (reasonText) => {
    if (wsStoppedManually) return;
    wsReconnectAttempt += 1;
    const delayMs = Math.min(30000, 3000 * Math.pow(1.5, Math.min(wsReconnectAttempt, 6)));
    logger.warn(
      'PTERO:WS',
      `Stream console terputus (${reasonText}). Menyambung ulang dalam ${(delayMs / 1000).toFixed(1)}d...`
    );
    wsReconnectTimer = setTimeout(() => {
      startPteroConsoleStream({ onConsoleLine, onStatusChange }).catch((err) =>
        logger.error('PTERO:WS', 'Gagal reconnect WebSocket Wings', err)
      );
    }, delayMs);
    if (typeof wsReconnectTimer.unref === 'function') wsReconnectTimer.unref();
  };

  try {
    const creds = await getPteroWebsocketCredentials();
    if (!creds?.socket || !creds?.token) {
      throw new Error('Kredensial socket/token Pterodactyl kosong');
    }

    if (wsClient) {
      try {
        wsClient.removeAllListeners();
        wsClient.terminate();
      } catch {
        // Abaikan
      }
      wsClient = null;
    }

    const originHeader = config.pterodactyl.panelUrl.replace(/\/+$/, '');
    const sock = new WebSocket(creds.socket, {
      headers: { Origin: originHeader },
      handshakeTimeout: 12000,
    });
    wsClient = sock;

    sock.on('open', () => {
      wsReconnectAttempt = 0;
      sock.send(JSON.stringify({ event: 'auth', args: [creds.token] }));
    });

    sock.on('message', async (rawBuf) => {
      let pkt = null;
      try {
        pkt = JSON.parse(rawBuf.toString('utf8'));
      } catch {
        return;
      }
      if (!pkt || !pkt.event) return;

      if (pkt.event === 'auth success') {
        logger.info('PTERO:WS', 'Terhubung ke stream WebSocket Pterodactyl Wings ♡');
        return;
      }

      if (pkt.event === 'token expiring' || pkt.event === 'token expired') {
        try {
          const fresh = await getPteroWebsocketCredentials();
          if (fresh?.token && sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ event: 'auth', args: [fresh.token] }));
          }
        } catch (err) {
          logger.warn('PTERO:WS', `Gagal memperbarui token WebSocket: ${err.message}`);
        }
        return;
      }

      if (pkt.event === 'status' && Array.isArray(pkt.args) && pkt.args[0]) {
        const nextState = String(pkt.args[0]).toLowerCase();
        const prevState = lastKnownServerState;
        lastKnownServerState = nextState;
        if (prevState !== nextState && typeof onStatusChange === 'function') {
          try {
            await onStatusChange(nextState, prevState);
          } catch (err) {
            logger.error('PTERO:WS', 'Error pada callback onStatusChange', err);
          }
        }
        return;
      }

      if (pkt.event === 'console output' && Array.isArray(pkt.args)) {
        for (const chunk of pkt.args) {
          const lines = String(chunk || '').split(/\r?\n/);
          for (const rawLine of lines) {
            const clean = stripAnsiAndMcCodes(rawLine);
            if (!clean) continue;
            if (wsOutputListeners.size > 0) {
              for (const fn of Array.from(wsOutputListeners)) {
                try {
                  fn(clean);
                } catch {
                  // Abaikan error collector sementara
                }
              }
            }
            if (typeof onConsoleLine === 'function') {
              try {
                await onConsoleLine(clean);
              } catch (err) {
                logger.error('PTERO:WS', 'Error pada callback onConsoleLine', err);
              }
            }
          }
        }
      }
    });

    sock.on('close', (code) => {
      wsClient = null;
      scheduleReconnect(`kode ${code}`);
    });

    sock.on('error', (err) => {
      logger.warn('PTERO:WS', `WebSocket Wings error: ${err.message}`);
    });

    return { started: true };
  } catch (err) {
    scheduleReconnect(err.message);
    return { started: false, reason: err.message };
  }
}

function stopPteroConsoleStream() {
  wsStoppedManually = true;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsClient) {
    try {
      wsClient.removeAllListeners();
      wsClient.close();
    } catch {
      // Abaikan
    }
    wsClient = null;
  }
}

module.exports = {
  stripAnsiAndMcCodes,
  sanitizeMinecraftText,
  formatSafeMcTarget,
  buildTellrawBroadcastCommand,
  buildSayBroadcastCommand,
  buildBridgeTellrawCommand,
  isPteroConfigured,
  isRconConfigured,
  pteroRequest,
  sendPteroCommand,
  sendRconCommand,
  executeMinecraftCommand,
  sendMinecraftBroadcast,
  sendMinecraftBridgeChat,
  whisperMinecraftPlayer,
  validateWhitelistedConsoleCommand,
  getServerResources,
  sendPowerSignal,
  listPteroBackups,
  createPteroServerBackup,
  getPteroWebsocketCredentials,
  getPteroStreamState,
  startPteroConsoleStream,
  stopPteroConsoleStream,
};
