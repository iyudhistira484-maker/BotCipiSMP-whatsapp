const config = require('../../config');
const { fetchMinecraftServerStatus } = require('../../lib/api');
const { renderServerCard } = require('../../lib/card');
const { renderBox, keep } = require('../../lib/smallcaps');
const { formatNumber, logger } = require('../../lib/logger');

module.exports = {
  name: 'server',
  alias: ['mc', 'statusmc', 'ip', 'cipismp'],
  category: 'server',
  description: 'Lihat kartu status server Minecraft (Java & Bedrock/Geyser) secara live',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const status = await fetchMinecraftServerStatus(
      config.minecraft.host,
      config.minecraft.port
    );

    const javaAddr =
      status.javaPort === 25565
        ? status.host
        : `${status.host}:${status.javaPort}`;

    const samplePlayersText =
      status.online && status.playerSample.length > 0
        ? status.playerSample
            .slice(0, 10)
            .map((p) => keep(p))
            .join(', ')
        : status.online
        ? 'Tidak ada daftar publik / 0 pemain'
        : '-';

    const caption = renderBox(
      '❖ sᴛᴀᴛᴜs sᴇʀᴠᴇʀ ᴍɪɴᴇᴄʀᴀꜰᴛ',
      [
        `✦ Status    : ${status.online ? 'ONLINE ✅' : 'OFFLINE / MAINTENANCE ❌'}`,
        `✦ IP Java   : ${keep(javaAddr)}`,
        `✦ Bedrock   : ${keep(status.host)} (Port ${status.bedrockPort})`,
        `✦ Versi     : ${keep(status.version || '-')}`,
        `✦ Pemain    : ${formatNumber(status.playersOnline)} / ${formatNumber(status.playersMax)} online`,
        `✦ MOTD      : ${keep(status.motd)}`,
        status.online && status.playerSample.length > 0
          ? `◦ Di Lobi   : ${samplePlayersText}`
          : '',
      ].filter(Boolean),
      { footer: config.footer }
    );

    let cardBuffer = null;
    try {
      cardBuffer = await renderServerCard(status);
    } catch (err) {
      logger.error('CMD:SERVER', 'Gagal merender kartu server Minecraft, memakai fallback teks', err);
    }

    const buttons = [
      {
        type: 'copy',
        text: '✿ Salin IP Server',
        copyCode: javaAddr,
      },
      {
        command: `${config.prefix}server`,
        text: '✦ Segarkan Status',
      },
    ];

    if (config.links.discord) {
      buttons.push({
        type: 'url',
        text: '❖ Discord CipiSMP',
        url: config.links.discord,
      });
    }

    await ctx.replyCard(cardBuffer, caption, {
      title: `❖ ${status.host} ❖`,
      buttons,
    });
  },
};
