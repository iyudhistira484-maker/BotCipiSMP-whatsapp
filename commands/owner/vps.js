const config = require('../../config');
const { isOwner } = require('../../lib/database');
const { formatUptime } = require('../../lib/logger');
const {
  getVpsSystemSnapshot,
  listTopVpsProcesses,
  listMountedDisks,
  listPm2Processes,
  killVpsProcess,
  abortSessionCommand,
} = require('../../lib/vps-control');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function maskIpForGroup(ipStr = '') {
  const s = String(ipStr || '').trim();
  if (!s) return '-';
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  }
  if (s.includes(':')) {
    return `${s.slice(0, 6)}:****`;
  }
  return '***';
}

module.exports = {
  name: 'vps',
  alias: ['host', 'sysinfo', 'nodevps'],
  category: 'owner',
  description: 'Kontrol resource VPS, monitor proses/disk/IP, & manajemen host (Khusus Owner)',
  cooldown: 2,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, isGroup, args, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Kontrol VPS hanya dapat diakses oleh Owner.']));
    }

    const sessionKey = `wa:${senderJid}`;
    const sub = String(args[0] || 'status').toLowerCase();

    // 1. Hentikan proses terminal yang sedang berjalan
    if (sub === 'stop' || sub === 'abort') {
      const res = abortSessionCommand(sessionKey, senderJid);
      if (!res.aborted) {
        return reply(formatWarning('Tidak Ada Proses Aktif', [res.message]));
      }
      return reply(
        formatSuccess('Proses Terminal Dihentikan', [
          `• PID     : ${mono(String(res.pid || '-'))}`,
          `• Command : ${mono(res.command.slice(0, 80))}`,
        ])
      );
    }

    // 2. Kill proses spesifik berdasarkan PID
    if (sub === 'kill') {
      const pidArg = args[1];
      const force = String(args[2] || '').toLowerCase() === 'force' || args[2] === '-9';
      if (!pidArg) {
        return reply(
          formatWarning('Masukkan Nomor PID', [
            `• Contoh lembut : ${mono(`${prefix}vps kill 12345`)}`,
            `• Contoh paksa  : ${mono(`${prefix}vps kill 12345 force`)}`,
            `• Cek daftar PID: ${mono(`${prefix}vps ps`)}`,
          ])
        );
      }

      const killed = killVpsProcess({
        pid: pidArg,
        signal: force ? 'SIGKILL' : 'SIGTERM',
        actorJid: senderJid,
        source: 'whatsapp',
      });
      if (!killed.ok) {
        return reply(formatError('Gagal Menghentikan Proses', [keep(killed.error)]));
      }
      return reply(
        formatSuccess('Sinyal Proses Terkirim', [
          `• Target PID : ${mono(String(killed.pid))}`,
          `• Sinyal     : ${mono(killed.signal)}`,
        ])
      );
    }

    // 3. Daftar proses teratas (CPU / RAM)
    if (sub === 'ps' || sub === 'top' || sub === 'proc') {
      const procs = await listTopVpsProcesses(12);
      if (!procs.length) {
        return reply(formatWarning('Daftar Proses Kosong', ['Tidak dapat membaca tabel proses OS saat ini.']));
      }
      const lines = procs.map(
        (p, idx) =>
          `${String(idx + 1).padStart(2, ' ')}. [${keep(String(p.pid))}] ${keep(
            p.command.slice(0, 18)
          )} — CPU ${keep(`${p.cpuPct}%`)} · RAM ${keep(`${p.rssMb} MB`)}${p.isSelf ? ' (bot)' : ''}`
      );
      lines.push('', `Ketik ${mono(`${prefix}vps kill <PID>`)} untuk menghentikan proses.`);
      return reply(
        renderBox('daftar proses vps teratas', lines, { footer: config.footer })
      );
    }

    // 4. Detail partisi penyimpanan
    if (sub === 'disk' || sub === 'storage' || sub === 'df') {
      const disks = await listMountedDisks();
      if (!disks.length) {
        return reply(formatWarning('Info Disk Tidak Tersedia', ['Tidak ada partisi yang terbaca.']));
      }
      const lines = disks.map(
        (d) =>
          `• ${mono(d.mount)} (${keep(d.filesystem)})\n  Pakai: ${keep(fmtBytes(d.usedBytes))} / ${keep(
            fmtBytes(d.totalBytes)
          )} (${keep(`${d.usedPct}%`)}) · Sisa ${keep(fmtBytes(d.freeBytes))}`
      );
      return reply(renderBox('partisi penyimpanan vps', lines, { footer: config.footer }));
    }

    // 5. Daftar service PM2 bila tersedia
    if (sub === 'pm2') {
      const pm2List = await listPm2Processes();
      if (!pm2List.length) {
        return reply(
          formatWarning('PM2 Tidak Terdeteksi / Kosong', [
            `Tidak ada proses PM2 aktif di user ini, atau gunakan ${mono(`${prefix}sh pm2 status`)}.`,
          ])
        );
      }
      const lines = pm2List.map(
        (p) =>
          `• [${keep(String(p.pmId))}] *${keep(p.name)}* (${keep(p.status)})\n  PID ${keep(
            String(p.pid)
          )} · CPU ${keep(`${p.cpuPct}%`)} · RAM ${keep(`${p.memMb} MB`)} · Restart ${keep(
            String(p.restarts)
          )}x`
      );
      return reply(renderBox('status daemon pm2 vps', lines, { footer: config.footer }));
    }

    // 6. Cek alamat IP VPS (disensor otomatis bila dipanggil di dalam grup!)
    if (sub === 'ip' || sub === 'net') {
      const snap = await getVpsSystemSnapshot({
        sessionKey,
        includePublicIp: true,
        processLimit: 3,
      });
      const pubIp = snap.network.publicIp
        ? isGroup
          ? `${maskIpForGroup(snap.network.publicIp)} (chat pribadi bot untuk IP penuh)`
          : snap.network.publicIp
        : 'Tidak terdeteksi otomatis';

      const ifaceLines = snap.network.interfaces.length
        ? snap.network.interfaces.map((n) => {
            const addr = isGroup ? maskIpForGroup(n.address) : n.address;
            return `• ${mono(n.iface)} (${keep(n.family)}) : ${mono(addr)}`;
          })
        : ['• Tidak ada interface eksternal aktif'];

      return reply(
        renderBox(
          'jaringan & alamat ip vps',
          [
            `• Hostname  : ${mono(snap.host.hostname)}`,
            `• IP Publik : ${mono(pubIp)}`,
            '',
            ...ifaceLines,
          ],
          { footer: config.footer }
        )
      );
    }

    // 7. Default: Ringkasan Status Host VPS Lengkap
    const snap = await getVpsSystemSnapshot({
      sessionKey,
      includePublicIp: false,
      processLimit: 5,
    });
    const rootDisk = snap.disks.find((d) => d.mount === '/') || snap.disks[0] || null;
    const swapLine =
      snap.memory.swapTotalBytes > 0
        ? `${fmtBytes(snap.memory.swapUsedBytes)} / ${fmtBytes(snap.memory.swapTotalBytes)} (${snap.memory.swapUsedPct}%)`
        : 'Tidak aktif';

    const lines = [
      `• Host     : ${mono(`${snap.terminal.user}@${snap.host.hostname}`)}`,
      `• OS       : ${keep(snap.host.distro)} (${keep(snap.host.arch)})`,
      `• Kernel   : ${keep(snap.host.kernel)}`,
      `• Uptime   : ${keep(formatUptime(snap.host.uptimeSec))} (Bot: ${keep(formatUptime(snap.host.botUptimeSec))})`,
      '',
      `• CPU      : ${keep(snap.cpu.model.slice(0, 38))} (${keep(`${snap.cpu.cores} Core`)})`,
      `• Beban    : ${keep(`${snap.cpu.hostPct}%`)} · Load ${keep(`${snap.cpu.load1} / ${snap.cpu.load5} / ${snap.cpu.load15}`)}`,
      `• RAM VPS  : ${keep(`${fmtBytes(snap.memory.usedBytes)} / ${fmtBytes(snap.memory.totalBytes)} (${snap.memory.usedPct}%)`)}`,
      `• Swap     : ${keep(swapLine)}`,
      rootDisk
        ? `• Disk (/) : ${keep(`${fmtBytes(rootDisk.usedBytes)} / ${fmtBytes(rootDisk.totalBytes)} (${rootDisk.usedPct}%)`)}`
        : '• Disk (/) : -',
      `• Bot Mem  : ${keep(`RSS ${snap.memory.botRssMb} MB · Heap ${snap.memory.botHeapUsedMb} MB · Node ${snap.host.nodeVersion}`)}`,
      `• Dir Aktif: ${mono(snap.terminal.displayCwd)}`,
      '',
      `Sub-menu: ${mono(`${prefix}vps ip`)} · ${mono(`${prefix}vps ps`)} · ${mono(`${prefix}vps disk`)} · ${mono(`${prefix}vps pm2`)}`,
      `Terminal: ${mono(`${prefix}sh <perintah>`)} atau ketik ${mono('$ <perintah>')}`,
    ];

    return reply(renderBox('kontrol & status vps', lines, { footer: config.footer }));
  },
};
