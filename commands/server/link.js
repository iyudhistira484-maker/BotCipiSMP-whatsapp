const config = require('../../config');
const {
  initiateAccountLink,
  resendAccountLinkPin,
  verifyAccountFromWhisperPin,
} = require('../../lib/bridge');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'link',
  alias: ['tautkan', 'bindmc', 'verifmc', 'verif'],
  category: 'server',
  description: 'Tautkan akun WhatsApp ke username Minecraft (Java & Geyser Bedrock)',
  cooldown: 1,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, commandName, args, text } = ctx;
    const p = config.prefix || '.';
    const bedrockPrefix = config.minecraft.bedrockPrefix || '.';
    const invokedAsVerif = ['verif', 'verifmc'].includes(String(commandName || '').toLowerCase());

    if (!text) {
      if (invokedAsVerif) {
        await ctx.reply(
          formatError('PIN Belum Diisi', [
            `Masukkan 6 angka PIN yang muncul di bisikan layar Minecraft kamu, contoh: ${mono(`${p}verif 482910`)}`,
            `Belum menerima PIN di layar MC? Masuk ke server lalu ketik ${mono(`${p}link kirim`)}`,
          ])
        );
        return;
      }

      await ctx.reply(
        renderBox(
          '✿ ᴄᴀʀᴀ ᴛᴀᴜᴛᴋᴀɴ ᴀᴋᴜɴ ᴍɪɴᴇᴄʀᴀꜰᴛ',
          [
            `✦ Pemain Java    : ${mono(`${p}link NamaJava`)}`,
            `✦ Pemain Bedrock : ${mono(`${p}link ${bedrockPrefix}NamaBedrock`)}`,
            `  atau ketik     : ${mono(`${p}link bedrock NamaBedrock`)}`,
            `✦ Masukkan PIN   : ${mono(`${p}link 123456`)} atau ${mono(`${p}verif 123456`)}`,
            `✦ Kirim Ulang PIN: ${mono(`${p}link kirim`)}`,
            '',
            `◦ Contoh Bedrock : ${mono(`${p}link ${bedrockPrefix}Sakura_BE`)}`,
          ],
          { footer: config.footer }
        )
      );
      return;
    }

    const firstToken = String(args[0] || '').trim();
    const firstLower = firstToken.toLowerCase();

    // 1. Subcommand Kirim Ulang PIN ke layar Minecraft (.link kirim / .link ulang / .link resend)
    if (['kirim', 'ulang', 'resend', 'kirimpin'].includes(firstLower)) {
      const resend = await resendAccountLinkPin(senderJid);
      if (!resend.ok) {
        if (resend.reason === 'already_verified') {
          await ctx.reply(
            formatSuccess('Sudah Terverifikasi', [
              `Akun WhatsApp kamu sudah resmi terhubung dengan ${keep(resend.mcUsername)}.`,
              `Ketik ${mono(`${p}akun`)} untuk melihat profil Minecraft kamu.`,
            ])
          );
          return;
        }
        await ctx.reply(
          formatError('Belum Ada Permintaan Aktif', [
            `Kamu belum memulai tautan akun Minecraft.`,
            `Ketik ${mono(`${p}link <username>`)} terlebih dahulu ya!`,
          ])
        );
        return;
      }

      if (resend.playerOffline) {
        await ctx.replyCard(
          null,
          formatWarning('Karakter Belum Terdeteksi di Server', [
            `Server melaporkan ${keep(resend.mcUsername)} sedang belum berada di dalam game.`,
            `1. Masuk dulu ke server ${keep(config.minecraft.host)} memakai akun ${keep(resend.mcUsername)}.`,
            `2. Setelah karaktermu sudah masuk ke dunia MC, tekan tombol Kirim Ulang PIN di bawah!`,
          ]),
          {
            title: '❖ Masuk ke Server Dulu ❖',
            buttons: [
              { command: `${p}link kirim`, text: '🔄 Kirim Ulang PIN ke MC' },
              { command: `${p}akun`, text: '✦ Cek Status Akun' },
            ],
          }
        );
        return;
      }

      await ctx.replyCard(
        null,
        formatSuccess('PIN Dikirim ke Layar Minecraft!', [
          `Bot baru saja mengirim bisikan 6 angka PIN ke akun ${keep(resend.mcUsername)} di dalam server.`,
          `Cek chat Minecraft kamu sekarang, lalu ketik ${mono(`${p}link <6-angka-PIN>`)} di sini!`,
          `Masa berlaku diperpanjang: ${resend.expiresInMinutes} menit.`,
        ]),
        {
          title: '❖ Cek Chat Minecraft Kamu ❖',
          buttons: [
            { command: `${p}link kirim`, text: '🔄 Kirim Ulang PIN' },
            { command: `${p}akun`, text: '✦ Cek Status Akun' },
          ],
        }
      );
      return;
    }

    // 2. Jalur Verifikasi PIN:
    //    - Dipanggil lewat .verif 482910 / .verifmc 482910
    //    - Dipanggil lewat .link verif 482910 / .link pin 482910
    //    - Dipanggil langsung .link 482910 (6 digit angka) atau .link CP-XXXXXX (salah tempel kode chat)
    const isExplicitVerifSubcmd = ['verif', 'verify', 'pin', 'konfirmasi'].includes(firstLower);
    const isDirectSixDigitPin = args.length === 1 && /^\d{6}$/.test(firstToken);
    const isMistakenPublicCode = /^CP-[A-Z0-9]{6}$/i.test(
      isExplicitVerifSubcmd ? String(args[1] || '').trim() : firstToken
    );

    if (invokedAsVerif || isExplicitVerifSubcmd || isDirectSixDigitPin || isMistakenPublicCode) {
      const pinInput = isExplicitVerifSubcmd
        ? args.slice(1).join('').trim()
        : text.trim();

      if (!pinInput) {
        await ctx.reply(
          formatError('PIN Belum Diisi', [
            `Masukkan 6 angka PIN yang muncul di bisikan layar Minecraft kamu, contoh: ${mono(`${p}link 482910`)}`,
          ])
        );
        return;
      }

      const verif = verifyAccountFromWhisperPin(senderJid, pinInput);
      if (!verif.ok) {
        if (verif.reason === 'already_verified') {
          await ctx.reply(
            formatSuccess('Sudah Terverifikasi', [
              `Akun WhatsApp kamu sudah terhubung dengan ${keep(verif.mcUsername)}.`,
              `Ketik ${mono(`${p}akun`)} untuk cek status atau ${mono(`${p}tukar`)} untuk menukar hadiah!`,
            ])
          );
          return;
        }
        if (verif.reason === 'public_code_in_wa') {
          await ctx.reply(
            formatWarning('Itu Kode Chat In-Game, Bukan PIN WA', [
              `Kode ${mono(verif.publicCode)} adalah kode untuk diketik di dalam chat Minecraft.`,
              `Untuk verifikasi lewat WhatsApp, masukkan 6 angka PIN dari bisikan bot di layar Minecraft (contoh: ${mono(`${p}link 482910`)}).`,
              `Belum dapat bisikan PIN? Masuk ke server lalu ketik ${mono(`${p}link kirim`)}!`,
            ])
          );
          return;
        }

        const msgMap = {
          no_pending: `Kamu belum memiliki permintaan ${mono(`${p}link <username>`)} yang aktif.`,
          expired: `Waktu verifikasi 10 menit sudah habis. Ketik ${mono(`${p}link kirim`)} untuk minta PIN baru!`,
          invalid_pin: `PIN verifikasi tidak cocok. Cek kembali 6 angka bisikan di layar Minecraft kamu, atau ketik ${mono(`${p}link kirim`)} bila belum muncul.`,
        };
        await ctx.reply(
          formatError('Verifikasi Gagal', [msgMap[verif.reason] || 'Verifikasi gagal.'])
        );
        return;
      }

      await ctx.reply(
        formatSuccess('Akun Berhasil Tertaut!', [
          `Akun ${keep(verif.mcUsername)} (${
            verif.isBedrock ? 'Bedrock / Geyser' : 'Java Edition'
          }) sekarang resmi terhubung dengan WhatsApp kamu!`,
          `Ketik ${mono(`${p}akun`)} untuk cek profil MC atau ${mono(`${p}tukar`)} untuk menukar Sakura Coin menjadi item in-game.`,
        ])
      );
      return;
    }

    // 3. Alur Utama: .link <username> atau .link bedrock <username>
    let editionFlag = '';
    let rawUsername = text.trim();
    if (firstLower === 'bedrock' && args.length >= 2) {
      editionFlag = 'bedrock';
      rawUsername = text.trim().slice('bedrock'.length).trim();
    } else if (firstLower === 'java' && args.length >= 2) {
      editionFlag = 'java';
      rawUsername = text.trim().slice('java'.length).trim();
    }

    const res = await initiateAccountLink(senderJid, rawUsername, editionFlag);
    if (!res.ok) {
      if (res.reason === 'already_linked_self') {
        await ctx.reply(
          formatError('Sudah Tertaut', [
            `WhatsApp kamu sudah terhubung dengan akun ${keep(res.existingUsername)}.`,
            `Jika ingin mengganti akun, lepas dulu lewat ${mono(`${p}unlink`)} ya!`,
          ])
        );
        return;
      }
      if (res.reason === 'username_taken' || res.reason === 'username_pending_other') {
        await ctx.reply(
          formatError('Username Sudah Dipakai', [
            `Akun Minecraft ${keep(res.username)} sudah ditautkan atau sedang diverifikasi oleh member lain.`,
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
      `✦ Berlaku   : ${res.expiresInMinutes} menit`,
      '',
    ];

    if (res.playerOffline) {
      guideLines.push(
        '❖ Langkah Verifikasi (Karaktermu Belum Online):',
        `1. Masuk ke server ${keep(config.minecraft.host)} memakai akun ${keep(res.mcUsername)}.`,
        `2. Setelah masuk di dalam dunia MC, tekan tombol "Kirim Ulang PIN ke MC" (${mono(`${p}link kirim`)}).`,
        `3. Lihat 6 angka PIN yang dibisikkan di layar MC, lalu ketik ${mono(`${p}link <PIN>`)} di WhatsApp!`
      );
    } else {
      guideLines.push(
        '❖ Cara Selesaikan Verifikasi:',
        `1. Pastikan akun ${keep(res.mcUsername)} sedang online di server ${keep(config.minecraft.host)}.`,
        res.whisperSent
          ? `2. Cek bisikan 6 angka PIN di layar chat Minecraft kamu, lalu balas di sini: ${mono(`${p}link <6-angka-PIN>`)}`
          : `2. Setelah masuk ke server, tekan tombol "Kirim Ulang PIN ke MC" lalu balas ${mono(`${p}link <6-angka-PIN>`)} di sini.`,
        `   (Baru masuk server & PIN belum muncul? Tekan tombol "Kirim Ulang PIN ke MC" di bawah!)`
      );
    }

    if (res.wsStreamConnected) {
      guideLines.push(
        '',
        `◦ Alternatif Cepat: Ketik kode ${mono(res.publicChatCode)} langsung di chat publik Minecraft!`
      );
    }

    const boxText = renderBox('✿ ᴠᴇʀɪꜰɪᴋᴀsɪ ᴀᴋᴜɴ ᴍɪɴᴇᴄʀᴀꜰᴛ', guideLines, {
      footer: config.footer,
    });

    const actionButtons = [
      {
        command: `${p}link kirim`,
        text: '🔄 Kirim Ulang PIN ke MC',
      },
    ];

    if (res.wsStreamConnected) {
      actionButtons.push({
        type: 'copy',
        text: '✿ Salin Kode Chat MC',
        copyCode: res.publicChatCode,
      });
    }

    actionButtons.push(
      {
        command: `${p}akun`,
        text: '✦ Cek Status Akun',
      },
      {
        command: `${p}unlink`,
        text: '❌ Batalkan Tautan',
      }
    );

    await ctx.replyCard(null, boxText, {
      title: '❖ Verifikasi Akun Minecraft ❖',
      buttons: actionButtons.slice(0, 3),
    });
  },
};
