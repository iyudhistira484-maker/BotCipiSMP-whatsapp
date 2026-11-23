const config = require('../../config');
const { renderStatusCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

/**
 * Buat format vCard kontak WhatsApp untuk Owner
 */
function buildOwnerVCard(phone, name) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `ORG:${config.botName};`,
    `TEL;type=CELL;type=VOICE;waid=${cleanPhone}:+${cleanPhone}`,
    'END:VCARD',
  ].join('\n');
}

module.exports = {
  name: 'owner',
  alias: ['creator', 'dev', 'adminbot'],
  category: 'info',
  description: 'Tampilkan kontak Owner pengembang bot & komunitas CipiSMP',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid } = ctx;
    const primaryOwner = config.ownerNumbers[0] || '6281234567890';
    const ownerName = config.ownerName || 'Owner CipiSMP';

    // 1. Kirim kartu kontak vCard resmi WhatsApp
    try {
      const contacts = config.ownerNumbers.map((num, idx) => ({
         vcard: buildOwnerVCard(
          num,
          idx === 0 ? ownerName : `${ownerName} #${idx + 1}`
        ),
      }));

      await sock.sendMessage(
        chatJid,
        {
          contacts: {
            displayName: ownerName,
            contacts,
          },
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.warn('CMD:OWNER', `Gagal mengirim vCard kontak owner: ${err.message}`);
    }

    // 2. Kirim kartu kawaii informasi Owner + tautan komunitas
    const caption = renderBox(
      'ɪɴꜰᴏ ᴏᴡɴᴇʀ ʙᴏᴛ',
      [
        `✦ Nama    : ${keep(ownerName)}`,
        `✦ Nomor   : +${keep(primaryOwner)}`,
        `✦ Server  : ${keep(config.minecraft.host)}`,
        `◦ Hubungi owner dengan sopan bila ada kendala atau keperluan penting ya ♡`,
      ],
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderStatusCard({
        title: 'Owner & Pengembang',
        subtitle: 'Jangan sungkan menyapa jika butuh bantuan seputar CipiSMP ya ♡',
        badgeText: '✦ DEVELOPER',
        badgeRarity: 'SSR',
        rows: [
          ['Nama Owner', keep(ownerName)],
          ['Kontak WA', keep(`+${primaryOwner}`)],
          ['Nama Bot', keep(config.botName)],
          ['Server MC', keep(config.minecraft.host)],
          ['Discord', keep(config.links.discord)],
        ],
        cacheKey: `owner:${primaryOwner}`,
        cacheTtlMs: 30000,
      });
    } catch (err) {
      logger.error('CMD:OWNER', 'Gagal merender kartu owner, memakai fallback teks', err);
    }

    const buttons = [
      { command: `${config.prefix}menu`, text: '✿ Kembali ke Menu' },
    ];
    if (config.links.discord) {
      buttons.push({
        type: 'url',
        text: '❖ Gabung Discord',
        url: config.links.discord,
      });
    }
    if (config.links.waGroup) {
      buttons.push({
        type: 'url',
        text: '✿ Grup WhatsApp',
        url: config.links.waGroup,
      });
    }

    await sendButtons(sock, chatJid, {
      title: `❖ ${ownerName} ❖`,
      text: caption,
      footer: config.footer,
      image: cardBuffer,
      ownerJid: senderJid,
      quoted: msg,
      buttons,
    });
  },
};
