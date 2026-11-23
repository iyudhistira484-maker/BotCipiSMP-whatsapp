const config = require('../../config');
const { normalizeUserJid, formatMentionTag } = require('../../lib/database');
const { transferCoins } = require('../../lib/economy');
const { formatSuccess, formatError, mono } = require('../../lib/smallcaps');
const { formatNumber } = require('../../lib/logger');

function extractCoinAmountToken(tokens = []) {
  // Cari dari belakang agar nama kontak berspasi (@Cello Cristia 2002) maupun (.transfer 2002 @Cello Cristia) terbaca akurat
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const raw = String(tokens[i] || '').trim();
    if (!raw || raw.startsWith('@')) continue;
    const cleaned = raw.replace(/[.,_]/g, '');
    if (/^[0-9]{1,9}$/.test(cleaned) && Number(cleaned) > 0) {
      return cleaned;
    }
  }
  return null;
}

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
    const { sock, msg, chatJid, senderJid, args, mentionedJids, quotedSenderJid } = ctx;
    const p = config.prefix;
    const cur = config.economy.currencyName;

    let targetJid = null;
    let rawAmount = null;

    if (mentionedJids && mentionedJids.length > 0) {
      targetJid = normalizeUserJid(mentionedJids[0]);
      rawAmount = extractCoinAmountToken(args);
    } else if (quotedSenderJid) {
      targetJid = normalizeUserJid(quotedSenderJid);
      rawAmount = extractCoinAmountToken(args);
    } else if (args.length >= 2) {
      let digits = String(args[0]).replace(/[^0-9]/g, '');
      if (digits.startsWith('08')) digits = `62${digits.slice(1)}`;
      else if (digits.startsWith('8') && digits.length >= 9) digits = `62${digits}`;
      if (digits.length >= 8) {
        targetJid = `${digits}@s.whatsapp.net`;
        rawAmount = String(args[1]).replace(/[.,_]/g, '');
      }
    }

    if (!targetJid || !rawAmount) {
      await ctx.reply(
        formatError('Format Transfer', [
          `Contoh 1: ${mono(`${p}transfer @teman 250`)}`,
          `Contoh 2: Balas pesan teman lalu ketik ${mono(`${p}transfer 250`)}`,
          `Contoh 3: ${mono(`${p}transfer 08123456789 250`)}`,
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

    const fromTag = formatMentionTag(senderJid, 'Pengirim');
    const toTag = formatMentionTag(targetJid, 'Penerima');

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
