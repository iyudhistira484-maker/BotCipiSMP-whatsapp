const config = require('../../config');
const { normalizeUserJid, extractPhoneFromJid } = require('../../lib/database');
const { transferCoins } = require('../../lib/economy');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

module.exports = {
  name: 'transfer',
  alias: ['tf', 'pay', 'kirim'],
  category: 'economy',
  description: 'Kirim Sakura Coin ke petualang lain (.transfer @user <jumlah>)',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, senderNumber, args, mentionedJids, quotedSenderJid } = ctx;
    const p = config.prefix;
    const cur = config.economy.currencyName;

    let targetJid = null;
    let rawAmount = null;

    if (mentionedJids && mentionedJids.length > 0) {
      targetJid = normalizeUserJid(mentionedJids[0]);
      // Cari token angka yang bukan @mention
      rawAmount = args.find((tok) => !tok.startsWith('@') && /^[0-9]+$/.test(tok));
    } else if (quotedSenderJid) {
      targetJid = normalizeUserJid(quotedSenderJid);
      rawAmount = args.find((tok) => /^[0-9]+$/.test(tok));
    } else if (args.length >= 2) {
      const digits = String(args[0]).replace(/[^0-9]/g, '');
      if (digits.length >= 8) {
        targetJid = `${digits}@s.whatsapp.net`;
        rawAmount = args[1];
      }
    }

    if (!targetJid || !rawAmount) {
      await ctx.reply(
        formatError('Format Transfer', [
          `Contoh 1: ${mono(`${p}transfer @teman 250`)}`,
          `Contoh 2: Balas pesan teman lalu ketik ${mono(`${p}transfer 250`)}`,
        ])
      );
      return;
    }

    const parsedAmount = Number(String(rawAmount).replace(/[^0-9]/g, ''));
    const res = transferCoins(senderJid, targetJid, parsedAmount);

    if (!res.ok) {
      if (res.reason === 'self_transfer') {
        await ctx.reply(
          formatError('Tidak Bisa ke Diri Sendiri', [
            'Eits, tidak perlu transfer ke dompetmu sendiri dong kak ♡',
          ])
        );
        return;
      }
      if (res.reason === 'below_minimum') {
        await ctx.reply(
          formatError('Nominal Terlalu Kecil', [
            `Minimal transfer adalah ${formatNumber(res.minTx)} ${cur} ya kak ♡`,
          ])
        );
        return;
      }
      if (res.reason === 'insufficient_funds') {
        await ctx.reply(
          formatError('Saldo Tidak Cukup', [
            `Saldo dompetmu saat ini ${formatNumber(res.senderBalance)} ${cur}, kurang untuk mengirim ${formatNumber(parsedAmount)} ${cur} ♡`,
          ])
        );
        return;
      }

      await ctx.reply(formatError('Transfer Gagal', ['Target penerima tidak valid nih kak ♡']));
      return;
    }

    const fromTag = senderNumber ? `@${senderNumber}` : 'Pengirim';
    const toPhone = extractPhoneFromJid(targetJid);
    const toTag = toPhone ? `@${toPhone}` : targetJid.split('@')[0];

    await sock.sendMessage(
      chatJid,
      {
        text: formatSuccess('Transfer Berhasil', [
          `Pengirim       : ${fromTag}`,
          `Penerima       : ${toTag}`,
          `Jumlah Dikirim : ${formatNumber(res.amount)} ${cur}`,
          `Sisa Saldomu   : ${formatNumber(res.senderBalance)} ${cur}`,
        ]),
        mentions: [senderJid, targetJid],
      },
      { quoted: msg }
    );
  },
};
