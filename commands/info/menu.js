const config = require('../../config');
const { getUserProfile, getTotalUsers } = require('../../lib/database');
const { renderMenuCard } = require('../../lib/card');
const { sendButtons } = require('../../lib/buttons');
const { groupCommandsByCategory, buildMenuText, buildMenuButtons } = require('../../lib/menu');
const { formatError, mono } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

module.exports = {
  name: 'menu',
  alias: ['help', 'allmenu', 'listmenu', 'fitur'],
  category: 'info',
  description: 'Tampilkan kartu menu utama & daftar kategori command',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      msg,
      chatJid,
      senderJid,
      senderNumber,
      pushName,
      isOwner,
      args,
      commandName,
      commands,
      botStartTime,
    } = ctx;

    const profile = getUserProfile(senderJid, pushName);
    const totalUsers = getTotalUsers();
    const uptimeMs = Date.now() - botStartTime;

    const categories = groupCommandsByCategory(commands, { includeOwner: isOwner });
    const query = (args[0] || '').trim().toLowerCase();
    const wantAll = commandName === 'allmenu' || query === 'all' || query === 'semua';

    let selectedCategory = null;
    if (query && !wantAll) {
      selectedCategory = categories.find(
        (c) => c.key === query || c.title.toLowerCase().includes(query)
      );
      if (!selectedCategory) {
        const available = categories.map((c) => mono(`${config.prefix}menu ${c.key}`)).join(', ');
        await ctx.reply(
          formatError('Kategori Tidak Ditemukan', [
            `Kategori "${query}" belum ada nih, kak ♡`,
            `Pilihan kategori: ${available}`,
          ])
        );
        return;
      }
    }

    const captionText = buildMenuText({
      senderJid,
      senderNumber,
      profile,
      uptimeMs,
      totalUsers,
      categories,
      selectedCategory,
      fullTextMode: wantAll,
    });

    const buttons = buildMenuButtons(categories);
    const mentions = senderJid ? [senderJid] : [];

    // Buat Kartu Menu Canvas dengan fallback aman ke teks biasa bila terjadi kendala
    let cardBuffer = null;
    try {
      cardBuffer = await renderMenuCard({
        userName: profile.name,
        level: profile.level,
        xp: profile.xp,
        xpNeeded: profile.xpNeeded,
        balance: profile.balance,
        isPremium: profile.premium.isPremium,
        isOwner: profile.premium.isOwner,
        uptimeMs,
        totalUsers,
        categories,
        selectedCategory,
      });
    } catch (err) {
      logger.error('CMD:MENU', 'Gagal membuat kartu canvas menu, memakai fallback teks', err);
    }

    if (cardBuffer) {
      await sendButtons(sock, chatJid, {
        title: `❖ ${config.botName} ❖`,
        text: captionText,
        footer: config.footer,
        image: cardBuffer,
        buttons,
        ownerJid: senderJid,
        mentions,
        quoted: msg,
      });
    } else {
      const fullFallback = buildMenuText({
        senderJid,
        senderNumber,
        profile,
        uptimeMs,
        totalUsers,
        categories,
        selectedCategory,
        fullTextMode: true,
      });
      await sock.sendMessage(
        chatJid,
        { text: fullFallback, mentions },
        { quoted: msg }
      );
    }
  },
};
