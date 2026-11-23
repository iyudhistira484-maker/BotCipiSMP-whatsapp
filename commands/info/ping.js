const os = require('os');
const config = require('../../config');
const { getDriverName, getTotalUsers, getTotalGroups } = require('../../lib/database');
const { renderStatusCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatUptime, formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'ping',
  alias: ['speed', 'runtime', 'statusbot'],
  category: 'info',
  description: 'Cek kecepatan respon, penggunaan RAM, dan uptime bot',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const startHr = process.hrtime.bigint();
    const { sock, msg, chatJid, senderJid, botStartTime } = ctx;

    // Hitung selisih dari timestamp pesan WA bila valid
    const msgTsSec = Number(msg?.messageTimestamp || 0);
    const waLatencyMs =
      msgTsSec > 0 ? Math.max(1, Date.now() - msgTsSec * 1000) : null;

    const memUsedMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
    const totalRamGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const uptimeStr = formatUptime(Date.now() - botStartTime);
    const dbDriver = getDriverName();
    const totalUsers = getTotalUsers();
    const totalGroups = getTotalGroups();

    const internalMs = Number(process.hrtime.bigint() - startHr) / 1e6;
    const displayPing = waLatencyMs && waLatencyMs < 60000
      ? `${waLatencyMs} ms (internal ${internalMs.toFixed(1)} ms)`
      : `${internalMs.toFixed(2)} ms`;

    const caption = renderBox(
      'sᴛᴀᴛᴜs & ᴋᴇᴄᴇᴘᴀᴛᴀɴ ʙᴏᴛ',
      [
        `✦ Kecepatan : ${keep(displayPing)}`,
        `✦ Uptime    : ${keep(uptimeStr)}`,
        `✦ Memori    : ${keep(`${memUsedMb} MB / ${totalRamGb} GB`)}`,
        `✦ Runtime   : ${keep(`Node.js ${process.version}`)}`,
        `✦ Database  : ${keep(dbDriver)} (${formatNumber(totalUsers)} user, ${formatNumber(totalGroups)} grup)`,
        `✦ Mode      : ${config.dryRun ? 'Dry-Run (Simulasi)' : 'Aktif Normal ♡'}`,
      ],
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderStatusCard({
        title: 'Status & Ping Bot',
        subtitle: `${config.botName} siap menemani 24 jam penuh semangat ♡`,
        badgeText: '✦ ONLINE 24/7',
        badgeRarity: 'SSR',
        rows: [
          ['Respon', keep(displayPing)],
          ['Uptime', keep(uptimeStr)],
          ['Memori RAM', keep(`${memUsedMb} MB / ${totalRamGb} GB`)],
          ['Node.js', keep(process.version)],
          ['Database', `${keep(dbDriver)} • ${formatNumber(totalUsers)} user`],
          ['Zona Waktu', keep('Asia/Jakarta (WIB)')],
        ],
        cacheKey: null, // Jangan di-cache agar nilai ping akurat real-time
      });
    } catch (err) {
      logger.error('CMD:PING', 'Gagal membuat kartu status ping, memakai fallback teks', err);
    }

    await sendButtons(sock, chatJid, {
      title: `❖ ${config.botName} ❖`,
      text: caption,
      footer: config.footer,
      image: cardBuffer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { command: `${config.prefix}menu`, text: '✿ Menu Utama' },
        { command: `${config.prefix}profil`, text: '♡ Profilku' },
      ],
    });
  },
};
