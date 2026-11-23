/**
 * =====================================================================
 * ✿ TEMPLATE 3: COMMAND API EKSTERNAL + LIMIT HARIAN WIB & FALLBACK ✿
 * =====================================================================
 * Cara pakai:
 * 1. Salin file ini ke dalam subfolder kategori, misalnya:
 *      cp commands/_template-api-limit.js commands/tools/faktamenarik.js
 * 2. Sesuaikan daftar provider API pada runWithApiFallback(...)
 * 3. Jalankan `.reload` dari WhatsApp Owner
 */

const config = require('../../config');
const { consumeDailyLimit, getDailyLimitStatus } = require('../../lib/limits');
const { runWithApiFallback, fetchJson } = require('../../lib/api');
const {
  renderBox,
  formatWarning,
  keep,
  mono,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'contohapi',
  alias: ['apidemo'],
  category: 'tools',
  description: 'Contoh template command API berlimit harian WIB dengan multi-fallback',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const { senderJid, prefix, reply } = ctx;

    // 1. Cek kuota harian WIB sebelum memanggil API (otomatis kuota ekstra bagi Sakura VIP)
    const preCheck = getDailyLimitStatus(senderJid, 'ai');
    if (preCheck.remaining <= 0) {
      return reply(
        formatWarning('Kuota Harian Habis 🌸', [
          `✦ Kuota harian kamu sudah terpakai penuh (${preCheck.used}/${preCheck.max}).`,
          `◦ Kuota akan direset otomatis pukul 00:00 WIB atau cek ${mono(`${prefix}vip`)}!`,
        ])
      );
    }

    // 2. Panggil API dengan timeout ketat & rantai fallback otomatis
    const data = await runWithApiFallback('DEMO_FACT', [
      {
        name: 'API Utama',
        fn: async () => {
          const json = await fetchJson(
            'https://uselessfacts.jsph.pl/api/v2/facts/random?language=en',
            { timeoutMs: 8000 }
          );
          if (!json?.text) throw new Error('Data kosong');
          return json.text;
        },
      },
      {
        name: 'Cadangan Lokal',
        fn: async () => 'Lebah di Minecraft bisa membantu tanaman tumbuh lebih cepat setelah menyerbuki bunga!',
      },
    ]);

    // 3. Potong 1 kuota harian setelah berhasil & tampilkan sisa limit
    const after = consumeDailyLimit(senderJid, 'ai', 1);
    const remainingLabel = after.isUnlimited
      ? '∞ (Owner)'
      : `${after.remaining}/${after.max}`;

    return reply(
      renderBox(
        '🌟 ꜰᴀᴋᴛᴀ ᴍᴇɴᴀʀɪᴋ ʜᴀʀɪ ɪɴɪ',
        [
          keep(data.result),
          '',
          `◦ Sumber: ${keep(data.provider)} | Sisa Limit Hari Ini: ${remainingLabel}`,
        ],
        { footer: config.footer }
      )
    );
  },
};
