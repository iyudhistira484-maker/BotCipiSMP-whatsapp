const config = require('../../config');
const { isOwner } = require('../../lib/database');
const {
  getSessionState,
  resetSessionState,
  abortSessionCommand,
  executeVpsCommand,
} = require('../../lib/vps-control');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  formatError,
  keep,
  mono,
} = require('../../lib/smallcaps');

const INLINE_OUTPUT_CHAR_LIMIT = 3000;

module.exports = {
  name: 'sh',
  alias: ['bash', 'exec', 'term', 'terminal'],
  category: 'owner',
  description: 'Akses terminal shell Linux VPS secara langsung dari WhatsApp (Khusus Owner)',
  cooldown: 1,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, text, prefix, reply } = ctx;
    if (!Boolean(ctx.isOwner || isOwner(senderJid))) {
      return reply(formatError('Khusus Owner', ['Akses terminal VPS hanya diizinkan untuk Owner.']));
    }

    const sessionKey = `wa:${senderJid}`;
    const rawCmd = String(text || '').trim();

    if (!rawCmd) {
      const st = getSessionState(sessionKey);
      return reply(
        renderBox(
          'terminal shell vps (owner)',
          [
            `• Sesi Aktif : ${mono(`${st.user}@${st.hostname}:${st.displayCwd}$`)}`,
            `• Shell      : ${mono(st.shell)} · Status: ${keep(st.running ? 'RUNNING' : 'IDLE')}`,
            '',
            `• Eksekusi   : ${mono(`${prefix}sh ls -la`)} atau ${mono('$ pm2 status')}`,
            `• Pindah Dir : ${mono(`${prefix}sh cd /var/log`)} (direktori tersimpan)`,
            `• Hentikan   : ${mono(`${prefix}sh stop`)} (bila proses berjalan lama)`,
            `• Reset Dir  : ${mono(`${prefix}sh reset`)} (kembali ke folder bot)`,
          ],
          { footer: config.footer }
        )
      );
    }

    const lower = rawCmd.toLowerCase();
    if (lower === 'stop' || lower === 'abort') {
      const aborted = abortSessionCommand(sessionKey, senderJid);
      if (!aborted.aborted) {
        return reply(formatWarning('Terminal Sedang Idle', [aborted.message]));
      }
      return reply(
        formatSuccess('Perintah Dihentikan', [
          `• PID     : ${mono(String(aborted.pid || '-'))}`,
          `• Command : ${mono(aborted.command.slice(0, 90))}`,
        ])
      );
    }

    if (lower === 'reset') {
      const st = resetSessionState(sessionKey, senderJid);
      return reply(
        formatSuccess('Sesi Terminal Direset', [
          `• Direktori Kerja : ${mono(st.cwd)}`,
        ])
      );
    }

    const beforeState = getSessionState(sessionKey);
    const res = await executeVpsCommand({
      sessionKey,
      actorJid: senderJid,
      source: 'whatsapp',
      command: rawCmd,
      timeoutMs: 30000,
      redactOutput: true,
    });

    if (!res.ok) {
      return reply(
        formatError('Eksekusi Terminal Ditolak', [
          keep(res.error || 'Gagal menjalankan perintah terminal.'),
        ])
      );
    }

    const afterState = res.state || beforeState;
    const promptHeader = `${beforeState.user}@${beforeState.hostname}:${beforeState.displayCwd}$ ${rawCmd}`;
    const cwdChangedNote =
      afterState.cwd !== beforeState.cwd ? `\n• Direktori baru: ${mono(afterState.displayCwd)}` : '';
    const statusLabel = res.timedOut
      ? `TIMEOUT · ${res.durationMs} ms`
      : `exit ${res.exitCode} · ${res.durationMs} ms`;

    const fullOutput = res.combined || '(selesai tanpa output teks)';

    // Bila output sangat panjang (> 3000 karakter), kirim cuplikan akhir + lampirkan file .txt utuh!
    if (fullOutput.length > INLINE_OUTPUT_CHAR_LIMIT && sock?.sendMessage) {
      const tailLines = fullOutput.split('\n').slice(-22).join('\n').slice(-1600);
      const caption = [
        `*TERMINAL VPS* (${keep(statusLabel)})`,
        mono(promptHeader.slice(0, 140)),
        cwdChangedNote ? cwdChangedNote.trim() : '',
        '',
        'Cuplikan baris terakhir (output penuh terlampir pada dokumen):',
        `\`\`\`\n${tailLines}\n\`\`\``,
      ]
        .filter(Boolean)
        .join('\n');

      return sock.sendMessage(
        chatJid,
        {
          document: Buffer.from(`${promptHeader}\n\n${fullOutput}\n`, 'utf8'),
          fileName: `vps-terminal-${Date.now()}.txt`,
          mimetype: 'text/plain',
          caption,
        },
        { quoted: msg }
      );
    }

    return reply(
      renderBox(
        `terminal vps (${keep(statusLabel)})`,
        [
          mono(promptHeader.slice(0, 180)),
          ...(cwdChangedNote ? [cwdChangedNote.trim()] : []),
          keep(`\`\`\`\n${fullOutput}\n\`\`\``),
        ],
        { footer: config.footer }
      )
    );
  },
};
