/**
 * ═══════════════════════════════════════════════════════════
 *  Cipi Panel (CP) — Production Control & Telemetry Daemon
 * ═══════════════════════════════════════════════════════════
 *  100% Real Node/OS Telemetry, Real SQLite WAL Database,
 *  Real 79-Command Registry, Real Backups — Zero Dummy Data.
 * ═══════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Opsional: --ephemeral-storage menempatkan file runtime (.db, backups, logs) di /tmp
// agar working tree git tetap bersih saat dijalankan di lingkungan sandbox.
const useEphemeralStorage =
  process.argv.includes('--ephemeral-storage') ||
  process.argv.includes('--preview') ||
  String(process.env.PANEL_SANDBOX_PREVIEW || '').toLowerCase() === 'true';

if (useEphemeralStorage) {
  const runtimeRoot = path.join(os.tmpdir(), 'cipi-panel-runtime');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, 'backups'), { recursive: true });

  process.env.PANEL_ENABLED = 'true';
  process.env.PANEL_HOST = process.env.PANEL_HOST || '0.0.0.0';
  process.env.PANEL_PORT = process.env.PANEL_PORT || '3000';
  process.env.DB_PATH = process.env.DB_PATH || path.join(runtimeRoot, 'cipismp.db');
  process.env.BACKUP_DIR = process.env.BACKUP_DIR || path.join(runtimeRoot, 'backups');
  process.env.SESSION_DIR = process.env.SESSION_DIR || path.join(runtimeRoot, 'session');
  process.env.LOG_DIR = process.env.LOG_DIR || path.join(runtimeRoot, 'logs');
} else {
  process.env.PANEL_ENABLED = 'true';
  process.env.PANEL_HOST = process.env.PANEL_HOST || '0.0.0.0';
}

const config = require('./config');
const { logger } = require('./lib/logger');
const { initDatabase, closeDatabase } = require('./lib/database');
const { loadCommands, getCommandsCatalog } = require('./index');
const { attachBotRuntimeToPanel, startControlPanelServer, stopControlPanelServer } = require('./lib/panel');

function inspectRealWhatsAppSession() {
  const credsPath = path.join(config.paths.session, 'creds.json');
  const hasCreds = fs.existsSync(credsPath);
  if (!hasCreds) {
    return { status: 'unlinked', botJid: null, pairingCode: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    const meId = raw?.me?.id ? String(raw.me.id).split(':')[0] + '@s.whatsapp.net' : null;
    return {
      status: 'session_saved',
      botJid: meId,
      pairingCode: null,
    };
  } catch {
    return { status: 'session_saved', botJid: null, pairingCode: null };
  }
}

async function bootStandalonePanel() {
  await initDatabase();
  const loaded = loadCommands();

  attachBotRuntimeToPanel({
    getSock: () => null,
    getWaState: () => inspectRealWhatsAppSession(),
    reloadCommands: () => {
      const res = loadCommands();
      return { commandsCount: res.count, aliasesCount: res.aliasCount };
    },
    getCommandsInfo: () => ({
      commandsCount: loaded.count,
      aliasesCount: loaded.aliasCount,
    }),
    getCommandsCatalog,
  });

  await startControlPanelServer();

  const waInfo = inspectRealWhatsAppSession();
  logger.info(
    'SYSTEM',
    `Cipi Panel (CP) aktif — ${loaded.count} command utama (${loaded.aliasCount} alias) dimuat dari disk.`
  );
  logger.info(
    'WA-SESSION',
    waInfo.status === 'unlinked'
      ? 'Sesi WhatsApp belum tertaut (session/creds.json kosong). Jalankan `npm start` di VPS untuk menautkan Baileys.'
      : `Kredensial sesi ditemukan (${waInfo.botJid || 'session/creds.json'}) — jalankan \`npm start\` untuk mengaktifkan socket live.`
  );
  logger.info(
    'TELEMETRY',
    'Sampler kernel & proses aktif: CPU %, Node RSS, V8 Heap, Event-Loop p99, SQLite WAL & Host Disk.'
  );
}

function shutdown(sig) {
  logger.info('SYSTEM', `Menerima sinyal ${sig}, menutup Cipi Panel...`);
  stopControlPanelServer().finally(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  bootStandalonePanel().catch((err) => {
    logger.error('PANEL-BOOT', 'Gagal menjalankan Cipi Panel', err);
    process.exit(1);
  });
}

module.exports = { bootStandalonePanel };
