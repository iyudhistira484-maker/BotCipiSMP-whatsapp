const config = require('../../config');
const {
  VALID_TICKET_CATEGORIES,
  createSupportTicket,
} = require('../../lib/scheduler');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'lapor',
  alias: ['report', 'keluhan', 'aduan'],
  category: 'community',
  description: 'Kirim tiket laporan/bantuan ke tim Admin (tersinkron langsung ke Discord)',
  cooldown: 10,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, pushName, text } = ctx;
    const p = config.prefix;

    if (!text) {
      await ctx.reply(
        renderBox(
          '🎫 ʟᴀʏᴀɴᴀɴ ᴛɪᴋᴇᴛ & ʟᴀᴘᴏʀᴀɴ',
          [
            `✦ Kirim Laporan : ${mono(`${p}lapor <kategori> | <isi laporan lengkap>`)}`,
            `✦ Atau Langsung : ${mono(`${p}lapor Ada bug chest hilang di koordinat 120 64 -200`)}`,
            '',
            `✦ Kategori      : ${VALID_TICKET_CATEGORIES.map((c) => mono(c)).join(', ')}`,
            `✦ Cek Tiketmu   : ${mono(`${p}tiket`)}`,
            '',
            '◦ Laporanmu otomatis masuk ke ruang Admin Discord & balasan Admin akan dikirim balik ke WA kamu! ♡',
          ],
          { footer: config.footer }
        )
      );
      return;
    }

    let categoryInput = 'umum';
    let messageInput = text.trim();

    if (text.includes('|')) {
      const [firstPart, ...rest] = text.split('|');
      const cand = firstPart.trim().toLowerCase();
      if (VALID_TICKET_CATEGORIES.includes(cand)) {
        categoryInput = cand;
        messageInput = rest.join('|').trim();
      }
    } else {
      const firstWord = (text.split(/\s+/)[0] || '').toLowerCase();
      if (VALID_TICKET_CATEGORIES.includes(firstWord) && text.trim().length > firstWord.length + 4) {
        categoryInput = firstWord;
        messageInput = text.trim().slice(firstWord.length).trim();
      }
    }

    const res = await createSupportTicket({
      senderRawJid: senderJid,
      pushName,
      categoryInput,
      messageInput,
    });

    if (!res.ok) {
      if (res.reason === 'too_many_open') {
        await ctx.reply(
          formatError('Batas Tiket Aktif', [
            'Kamu masih memiliki 3 tiket terbuka yang sedang ditangani Admin ♡',
            `Cek atau tutup tiket lama lewat ${mono(`${p}tiket`)} terlebih dahulu ya!`,
          ])
        );
        return;
      }
      await ctx.reply(
        formatError('Laporan Terlalu Singkat', [
          'Tuliskan kronologi atau detail kendalamu minimal 1 kalimat jelas ya kak ♡',
        ])
      );
      return;
    }

    const box = formatSuccess(`Tiket #${keep(res.ticketNo)} Terkirim!`, [
      `✦ Nomor Tiket : ${keep(res.ticketNo)}`,
      `✦ Kategori    : ${keep(res.category.toUpperCase())}`,
      `✦ Sinkron DC  : ${res.syncedDiscord ? `Terkirim (${keep(res.via)}) ✅` : 'Tersimpan di Antrean Admin ✅'}`,
      '',
      `◦ Saat Admin membalas dari Discord/WA, pesannya akan langsung masuk ke chat kamu!`,
      `◦ Tambah info dengan ${mono(`${p}tiket balas ${res.ticketNo} <pesan>`)} ♡`,
    ]);

    await ctx.replyCard(null, box, {
      title: `🎫 Tiket #${res.ticketNo}`,
      buttons: [
        { command: `${p}tiket`, text: '✦ Cek Daftar Tiket' },
        { command: `${p}tiket tutup ${res.ticketNo}`, text: '🔒 Tutup Tiket' },
      ],
    });
  },
};
