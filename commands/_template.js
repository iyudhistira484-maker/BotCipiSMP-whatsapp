/**
 * =====================================================================
 * ✿ TEMPLATE COMMAND MODULAR CIPISMP BOT ✿
 * =====================================================================
 * Cara menambah command baru:
 * 1. Salin file ini ke salah satu folder kategori di dalam commands/,
 *    misalnya: commands/fun/halo.js (JANGAN diawali garis bawah "_")
 * 2. Sesuaikan properti name, alias, category, description, cooldown, & flag
 * 3. Tulis logika pada fungsi async execute(ctx)
 * 4. Bot akan memuat file secara otomatis saat dijalankan!
 */

const config = require('../config');
const { formatSuccess, keep } = require('../lib/smallcaps');

module.exports = {
  name: 'contoh',
  alias: ['example'],
  category: 'fun',
  description: 'Contoh template command kawaii untuk pengembang',
  cooldown: 4,

  // Flag hak akses & ruang obrolan
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  /**
   * @param {object} ctx Konteks eksekusi pesan dari index.js
   */
  async execute(ctx) {
    const { pushName, text } = ctx;
    await ctx.reply(
      formatSuccess('Halo Petualang', [
        `Hai ${keep(pushName)} ♡`,
        text ? `Kamu mengetik: ${keep(text)}` : `Gunakan prefix ${keep(config.prefix)} untuk memanggilku ya!`,
      ])
    );
  },
};
