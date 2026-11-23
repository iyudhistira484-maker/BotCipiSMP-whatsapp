const config = require('../../config');
const { isOwner } = require('../../lib/database');
const {
  getSystemDiagnostics,
  getRecentAuditLogs,
} = require('../../lib/owner-manager');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, formatError, keep, mono } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'logs',
  alias: ['botstat', 'audit', 'diagnostik'],
  category: 'owner',
  description: 'Panel diagnostik 24/7, penggunaan RAM/DB, mode bot, & riwayat log audit Owner',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, args, commands, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Perintah ini hanya untuk Owner CipiSMP ♡']));
    }

    const arg0 = String(args[0] || '').toLowerCase().trim();
    const isNum = /^\d+$/.test(arg0);
    const limit = isNum ? Number(arg0) : 6;
    const catFilter = !isNum && arg0 ? arg0 : '';

    const diag = getSystemDiagnostics(commands ? commands.size : 0);
    const op = diag.operational;
    const recentLogs = getRecentAuditLogs(limit, catFilter);

    const lines = [
      `✦ Mode Akses   : ${op.botMode === 'self' ? '🤫 SELF (Owner)' : '🌐 PUBLIC'}`,
      `✦ Maintenance  : ${op.maintenance ? '🟡 AKTIF' : '🟢 OFF'} | Dry-Run: ${op.dryRun ? 'ON' : 'OFF'}`,
      `✦ Uptime       : ${keep(diag.uptimeText)}`,
      `✦ Memori       : RSS ${diag.ramRssMb} MB (Heap ${diag.heapUsedMb} MB)`,
      `✦ Mesin Inti   : Node ${keep(diag.nodeVersion)} | DB ${keep(diag.sqliteDriver)} (${diag.dbSizeKb} KB) | Card ${keep(diag.cardEngine)}`,
      `✦ Statistik    : ${formatNumber(diag.usersCount)} User | ${diag.groupsCount} Grup | ${diag.linkedMcCount} Akun MC | ${diag.activeVipCount} VIP | ${diag.bannedCount} Ban`,
      `✦ Command Aktif: ${diag.commandsCount} Command Utama | Tiket Terbuka: ${diag.openTicketsCount}`,
      '',
      `❖ Log Audit Terbaru${catFilter ? ` [${keep(catFilter)}]` : ''}:`,
    ];

    if (recentLogs.length === 0) {
      lines.push('  ◦ Belum ada catatan log pada filter ini.');
    } else {
      for (const l of recentLogs) {
        lines.push(
          `  ◦ [${keep(l.timeWib.slice(5, 16))}] [${keep(l.category)}] ${keep(l.action)} -> ${keep(l.target || '-')}`
        );
      }
    }

    lines.push(
      '',
      `◦ Filter log: ${mono(`${prefix}logs 10`)}, ${mono(`${prefix}logs owner_admin`)}, ${mono(`${prefix}logs premium`)}`
    );

    await sendButtons(sock, chatJid, {
      title: '❖ Panel Operasional 24/7 CipiSMP ❖',
      text: renderBox('📊 ᴅɪᴀɢɴᴏsᴛɪᴋ & ʟᴏɢ ᴀᴜᴅɪᴛ', lines, {
        footer: config.footer,
      }),
      footer: config.footer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}backupdb`, text: '💾 Backup DB Sekarang' },
        { id: `${prefix}reload`, text: '♻️ Hot-Reload Command' },
        {
          id: op.botMode === 'self' ? `${prefix}public` : `${prefix}self`,
          text: op.botMode === 'self' ? '🌐 Ubah ke Public' : '🤫 Ubah ke Self',
        },
      ],
    });
  },
};
