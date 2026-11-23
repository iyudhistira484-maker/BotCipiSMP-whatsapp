const config = require('../../config');
const {
  initiateAccountLink,
  verifyAccountFromWhisperPin,
} = require('../../lib/bridge');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'link',
  alias: ['tautkan', 'bindmc', 'verifmc'],
  category: 'server',
  description: 'Tautkan akun WhatsApp ke username Minecraft (Java & Geyser Bedrock)',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, args, text } = ctx;
    const p = config.prefix;
    const bedrockPrefix = config.minecraft.bedrockPrefix || '.';

    if (!text) {
      await ctx.reply(
        renderBox(
          '✿ ᴄᴀʀᴀ ᴛᴀᴜᴛᴋᴀɴ ᴀᴋᴜɴ ᴍɪɴᴇᴄʀᴀꜰᴛ',
          [
            `✦ Pemain Java    : ${mono(`${p}link NamaJava`)}`,
            `✦ Pemain Bedrock : ${mono(`${p}link ${bedrockPrefix}NamaBedrock`)}`,
            `  atau ketik     : ${mono(`${p}link bedrock NamaBedrock`)}`,
            `✦ Punya PIN Bisik: ${mono(`${p}link verif 123456`)}`,
            '',
            `◦ Contoh Bedrock : ${mono(`${p}link ${bedrockPrefix}Sakura_BE`)}`,
          ],
          { footer: config.footer }
        )
      );
      return;
    }

    // Subcommand: .link verif <6-digit PIN dari whisper /tell in-game>
    if (['verif', 'verify', 'pin', 'konfirmasi'].includes((args[0] || '').toLowerCase())) {
      const pinInput = args[1] || '';
      if (!pinInput) {
        await ctx.reply(
          formatError('PIN Belum Diisi', [
            `Masukkan 6 angka PIN yang dibisikkan bot di layar Minecraft kamu, contoh: ${mono(`${p}link verif 482910`)}`,
          ])
        );
        return;
      }

      const verif = verifyAccountFromWhisperPin(senderJid, pinInput);
      if (!verif.ok) {
        const msgMap = {
          no_pending: `Kamu belum memiliki permintaan ${mono(`${p}link`)} yang aktif ♡`,
          expired: `Waktu verifikasi 10 menit sudah habis. Yuk ulangi ${mono(`${p}link <username>`)} lagi!`,
          invalid_pin: 'PIN verifikasi tidak cocok. Cek kembali bisikan chat di dalam Minecraft ya ♡',
        };
        await ctx.reply(
          formatError('Verifikasi Gagal', [msgMap[verif.reason] || 'Verifikasi gagal.'])
        );
        return;
      }

      await ctx.reply(
        formatSuccess('Akun Berhasil Tertaut!', [
          `Yatta! Akun ${keep(verif.mcUsername)} (${
            verif.isBedrock ? 'Bedrock / Geyser' : 'Java Edition'
          }) sekarang resmi terhubung dengan WhatsApp kamu ♡`,
          `Ketik ${mono(`${p}akun`)} untuk cek profil MC atau ${mono(`${p}tukar`)} untuk menukar Sakura Coin menjadi item in-game!`,
        ])
      );
      return;
    }

    // Alur utama: .link <username> atau .link bedrock <username>
    let editionFlag = '';
    let rawUsername = text.trim();
    if ((args[0] || '').toLowerCase() === 'bedrock' && args.length >= 2) {
      editionFlag = 'bedrock';
      rawUsername = text.trim().slice('bedrock'.length).trim();
    } else if ((args[0] || '').toLowerCase() === 'java' && args.length >= 2) {
      editionFlag = 'java';
      rawUsername = text.trim().slice('java'.length).trim();
    }

    const res = await initiateAccountLink(senderJid, rawUsername, editionFlag);
    if (!res.ok) {
      if (res.reason === 'already_linked_self') {
        await ctx.reply(
          formatError('Sudah Tertaut', [
            `WhatsApp kamu sudah terhubung dengan akun ${keep(res.existingUsername)} ♡`,
            `Jika ingin mengganti akun, lepas dulu lewat ${mono(`${p}unlink`)} ya!`,
          ])
        );
        return;
      }
      if (res.reason === 'username_taken' || res.reason === 'username_pending_other') {
        await ctx.reply(
          formatError('Username Sudah Dipakai', [
            `Akun Minecraft ${keep(res.username)} sudah ditautkan atau sedang diverifikasi oleh member lain ♡`,
          ])
        );
        return;
      }

      await ctx.reply(
        formatError('Format Username Tidak Valid', [
          'Username Java terdiri dari 3–16 huruf/angka/underscore.',
          `Untuk pemain Bedrock (Geyser), awali dengan "${keep(bedrockPrefix)}" contoh: ${mono(`${p}link ${bedrockPrefix}Steve_BE`)}`,
        ])
      );
      return;
    }

    const editionLabel = res.isBedrock
      ? `Bedrock / Geyser (awalan "${keep(bedrockPrefix)}")`
      : 'Java Edition';

    const guideLines = [
      `✦ Username  : ${keep(res.mcUsername)}`,
      `✦ Edisi     : ${editionLabel}`,
      `✦ Kode Chat : ${keep(res.publicChatCode)}`,
      `✦ Berlaku   : ${res.expiresInMinutes} menit`,
      '',
      '❖ Cara Menyelesaikan Verifikasi:',
      `1. Masuk ke server ${keep(config.minecraft.host)} dengan akun ${keep(res.mcUsername)}.`,
      `2. Ketik kode ${mono(res.publicChatCode)} di chat publik Minecraft — bot akan otomatis memverifikasi akunmu!`,
      res.whisperSent
        ? `3. Alternatif: Bot juga baru saja membisikkan 6 angka PIN ke layar Minecraft kamu, ketik ${mono(`${p}link verif <PIN>`)} di sini ♡`
        : `3. Atau bila kamu menerima bisikan PIN di dalam game, ketik ${mono(`${p}link verif <PIN>`)} di sini ♡`,
    ];

    const boxText = renderBox('✿ ᴠᴇʀɪꜰɪᴋᴀsɪ ᴀᴋᴜɴ ᴍɪɴᴇᴄʀᴀꜰᴛ', guideLines, {
      footer: config.footer,
    });

    await ctx.replyCard(null, boxText, {
      title: '❖ Verifikasi Akun Minecraft ❖',
      buttons: [
        {
          type: 'copy',
          text: '✿ Salin Kode Chat',
          copyCode: res.publicChatCode,
        },
        {
          command: `${p}akun`,
          text: '✦ Cek Status Akun',
        },
        {
          command: `${p}unlink`,
          text: '❌ Batalkan Tautan',
        },
      ],
    });
  },
};
