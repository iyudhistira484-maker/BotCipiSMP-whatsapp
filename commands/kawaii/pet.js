const config = require('../../config');
const {
  PET_SPECIES,
  getSyncedPet,
  adoptPet,
  feedPet,
  playWithPet,
  restPet,
  renamePet,
} = require('../../lib/kawaii');
const { renderPetCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const {
  renderBox,
  formatSuccess,
  formatWarning,
  keep,
  mono,
} = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'pet',
  alias: ['peliharaan', 'mypet', 'tamagotchi'],
  category: 'kawaii',
  description: 'Adopsi & rawat Pet Virtual kawaii (makan, main, istirahat, naik level)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, args, prefix, reply } = ctx;
    const sub = String(args[0] || '').toLowerCase().trim();

    // 1. Adopsi Pet Baru (.pet adopsi <jenis> [nama])
    if (sub === 'adopsi' || sub === 'adopt') {
      const speciesArg = String(args[1] || '').toLowerCase().trim();
      const customName = args.slice(2).join(' ').trim();

      if (!speciesArg || !PET_SPECIES[speciesArg]) {
        const listLines = Object.values(PET_SPECIES).map(
          (s) => `◦ ${s.emoji} ${mono(s.type)} — ${s.label}`
        );
        return sendButtons(sock, chatJid, {
          title: '❖ Rumah Adopsi Pet CipiSMP ❖',
          text: renderBox(
            'ᴘɪʟɪʜ ᴘᴇᴛ ᴠɪʀᴛᴜᴀʟᴍᴜ',
            [
              '✦ Adopsi sahabat kecil gratis untuk menemani petualanganmu:',
              ...listLines,
              '',
              `✦ Contoh: ${mono(`${prefix}pet adopsi kitsune Kurama`)}`,
            ],
            { footer: config.footer }
          ),
          footer: config.footer,
          ownerJid: senderJid,
          quoted: msg,
          buttons: [
            { id: `${prefix}pet adopsi neko Mochi`, text: '🐱 Adopsi Neko' },
            { id: `${prefix}pet adopsi kitsune Koharu`, text: '🦊 Adopsi Kitsune' },
            { id: `${prefix}pet adopsi dragon Celestia`, text: '🐲 Adopsi Dragon' },
          ],
        });
      }

      const res = adoptPet(senderJid, speciesArg, customName);
      if (!res.ok) {
        return reply(
          formatWarning('Kamu Sudah Punya Pet ♡', [
            `✦ Pet kamu saat ini: ${keep(res.existing.pet_name)} (${res.existing.pet_type})`,
            `◦ Cek kondisinya dengan ${mono(`${prefix}pet`)} atau ganti namanya dengan ${mono(`${prefix}pet nama <nama_baru>`)}!`,
          ])
        );
      }

      return sendPetStatusWithCard(ctx, res.pet, [
        `🎉 Selamat! Kamu resmi mengadopsi ${res.pet.speciesMeta.emoji} ${keep(res.pet.pet_name)}!`,
        `✦ "${res.pet.speciesMeta.Catchphrase}"`,
      ]);
    }

    // Cek apakah sudah memiliki pet untuk aksi perawatan lainnya
    const currentPet = getSyncedPet(senderJid);
    if (!currentPet) {
      const speciesLines = Object.values(PET_SPECIES).map(
        (s) => `◦ ${s.emoji} ${mono(s.type)} — ${s.label}`
      );
      return sendButtons(sock, chatJid, {
        title: '❖ Kamu Belum Punya Pet ❖',
        text: renderBox(
          'ᴀᴅᴏᴘsɪ ᴘᴇᴛ ᴠɪʀᴛᴜᴀʟ ʏᴜᴋ!',
          [
            '✦ Kamu belum memiliki peliharaan virtual nih~',
            '✦ Pilihan jenis sahabat kawaii (Gratis!):',
            ...speciesLines,
            '',
            `✦ Ketik: ${mono(`${prefix}pet adopsi <jenis> [nama]`)}`,
          ],
          { footer: config.footer }
        ),
        footer: config.footer,
        ownerJid: senderJid,
        quoted: msg,
        buttons: [
          { id: `${prefix}pet adopsi neko Mochi`, text: '🐱 Kucing Sakura' },
          { id: `${prefix}pet adopsi kitsune Koharu`, text: '🦊 Rubah Bintang' },
          { id: `${prefix}pet adopsi usagi Dango`, text: '🐰 Kelinci Mochi' },
        ],
      });
    }

    // 2. Beri Makan (.pet makan / feed)
    if (sub === 'makan' || sub === 'feed') {
      const res = feedPet(senderJid);
      if (!res.ok) {
        return reply(
          formatWarning('Sakura Coin Kurang', [
            `✦ Biaya camilan pet lezat: ${res.cost} ${config.economy.currencyName}`,
            `◦ Yuk klaim ${mono(`${prefix}daily`)} atau ${mono(`${prefix}kerja`)} dulu~`,
          ])
        );
      }

      const extra = [
        `🍓 Nyam-nyam! ${keep(res.pet.pet_name)} lahap makan camilan (-${res.cost} Koin, +28 XP Pet)!`,
      ];
      if (res.leveledUp) {
        extra.push(`🎊 LEVEL UP! ${keep(res.pet.pet_name)} naik ke Level ${res.pet.level}! ✨`);
      }
      return sendPetStatusWithCard(ctx, res.pet, extra);
    }

    // 3. Ajak Bermain (.pet main / play)
    if (sub === 'main' || sub === 'play') {
      const res = playWithPet(senderJid);
      if (!res.ok) {
        if (res.reason === 'too_tired') {
          return reply(
            formatWarning(`${keep(currentPet.pet_name)} Sedang Mengantuk 💤`, [
              `✦ Energi pet tersisa ${currentPet.energy}%.`,
              `✦ Biarkan beristirahat sebentar dengan ${mono(`${prefix}pet tidur`)} ya!`,
            ])
          );
        }
        return reply(
          formatWarning(`${keep(currentPet.pet_name)} Lapar 🍓`, [
            `✦ Kenyang pet tinggal ${currentPet.hunger}%.`,
            `✦ Beri makan dulu dengan ${mono(`${prefix}pet makan`)} sebelum diajak main ya!`,
          ])
        );
      }

      const extra = [
        `🎀 Seru banget bermain bersama ${keep(res.pet.pet_name)} (+38 XP Pet)!`,
        `🪙 Wah, petmu menemukan +${formatNumber(res.foundCoins)} ${config.economy.currencyName} di taman!`,
      ];
      if (res.leveledUp) {
        extra.push(`🎊 LEVEL UP! ${keep(res.pet.pet_name)} naik ke Level ${res.pet.level}! ✨`);
      }
      return sendPetStatusWithCard(ctx, res.pet, extra);
    }

    // 4. Istirahat / Tidur (.pet tidur / rest)
    if (sub === 'tidur' || sub === 'istirahat' || sub === 'rest' || sub === 'sleep') {
      const res = restPet(senderJid);
      return sendPetStatusWithCard(ctx, res.pet, [
        `💤 Zzz... ${keep(res.pet.pet_name)} tidur pulas di bantal sakura! Energi kembali 100%!`,
      ]);
    }

    // 5. Ganti Nama Pet (.pet nama <nama_baru>)
    if (sub === 'nama' || sub === 'rename') {
      const nextName = args.slice(1).join(' ').trim();
      const res = renamePet(senderJid, nextName);
      if (!res.ok) {
        return reply(
          formatWarning('Nama Pet Belum Valid', [
            `✦ Masukkan nama 2–24 karakter, contoh: ${mono(`${prefix}pet nama Choco`)}`,
          ])
        );
      }
      return reply(
        formatSuccess('Nama Pet Diperbarui ♡', [
          `✦ Sahabat kecilmu kini bernama: ${keep(res.newName)}!`,
        ])
      );
    }

    // 6. Tampilan Status Pet Utama (.pet)
    return sendPetStatusWithCard(ctx, currentPet, []);
  },
};

async function sendPetStatusWithCard(ctx, pet, highlightLines = []) {
  const { sock, msg, chatJid, senderJid, pushName, prefix } = ctx;

  const lines = [
    ...highlightLines,
    ...(highlightLines.length > 0 ? [''] : []),
    `✦ Nama Pet : ${pet.speciesMeta.emoji} ${keep(pet.pet_name)} (${pet.speciesMeta.label})`,
    `✦ Level    : Lv.${pet.level} (${pet.xp}/${pet.xpNeeded} XP)`,
    `✦ Kenyang  : ${pet.hunger}% | Ceria: ${pet.happiness}% | Energi: ${pet.energy}%`,
    `◦ Ganti nama: ${mono(`${prefix}pet nama <nama>`)}`,
  ];

  const caption = renderBox('ᴋᴀʀᴛᴜ ᴘᴇᴛ ᴠɪʀᴛᴜᴀʟ', lines, { footer: config.footer });

  let cardBuffer = null;
  try {
    cardBuffer = await renderPetCard({
      pet,
      speciesMeta: pet.speciesMeta,
      ownerName: pushName || 'Petualang',
    });
  } catch (err) {
    logger.error('CMD:PET', 'Gagal merender kartu pet, memakai fallback teks', err);
  }

  await sendButtons(sock, chatJid, {
    title: `❖ Pet ${keep(pet.pet_name)} (Lv.${pet.level}) ❖`,
    text: caption,
    footer: config.footer,
    image: cardBuffer,
    ownerJid: senderJid,
    quoted: msg,
    buttons: [
      { id: `${prefix}pet makan`, text: '🍓 Beri Makan (50)' },
      { id: `${prefix}pet main`, text: '🎀 Ajak Main' },
      { id: `${prefix}pet tidur`, text: '💤 Istirahat' },
    ],
  });
}
