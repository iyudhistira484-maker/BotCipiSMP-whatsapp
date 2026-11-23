/**
 * =====================================================================
 * ✿ TEMPLATE 2: COMMAND KARTU CANVAS + TOMBOL INTERAKTIF ✿
 * =====================================================================
 * Cara pakai:
 * 1. Salin file ini ke dalam subfolder kategori, misalnya:
 *      cp commands/_template-buttons-card.js commands/info/infoserverku.js
 * 2. Ubah name, alias, category, dan isi kartu/tombol sesuai kebutuhan
 * 3. Jalankan `.reload` dari WhatsApp Owner (tanpa perlu restart bot!)
 */

const config = require('../../config');
const { renderStatusCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const { renderBox, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'contohkartu',
  alias: ['carddemo'],
  category: 'info',
  description: 'Contoh template command dengan Kartu Canvas lokal + Tombol Interaktif',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, msg, chatJid, senderJid, pushName, prefix } = ctx;

    // 1. Render Kartu Gambar lokal (otomatis fallback ke SVG sharp bila canvas absen)
    const cardBuffer = await renderStatusCard({
      title: 'KARTU SAPAAN CIPISMP',
      subtitle: `Halo kak ${pushName || 'Petualang'}!`,
      rows: [
        { label: 'Server MC', value: config.minecraft.host },
        { label: 'Mata Uang', value: config.economy.currencyName },
      ],
    });

    // 2. Susun caption kawaii singkat
    const caption = renderBox(
      '✨ ᴋᴀʀᴛᴜ sᴀᴘᴀᴀɴ ᴄɪᴘɪsᴍᴘ',
      [
        `✦ Halo kak ${keep(pushName || 'Petualang')} ♡`,
        '✦ Tombol di bawah otomatis fallback ke teks bila USE_BUTTONS=false!',
      ],
      { footer: config.footer }
    );

    // 3. Kirim dengan sendButtons (terkunci ke pengirim & kedaluwarsa otomatis)
    await sendButtons(sock, chatJid, {
      title: `❖ ${config.botName} ❖`,
      text: caption,
      footer: config.footer,
      image: cardBuffer,
      ownerJid: senderJid,
      quoted: msg,
      buttons: [
        { id: `${prefix}menu`, text: '📖 Buka Menu' },
        { id: `${prefix}profil`, text: '🪪 Kartu Profil' },
      ],
    });
  },
};
