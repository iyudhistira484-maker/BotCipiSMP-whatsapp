const { initiateBroadcastFlow } = require('../../lib/broadcast');

module.exports = {
  name: 'bcmc',
  alias: ['broadcastmc'],
  category: 'owner',
  description: 'Broadcast pengumuman ke server Minecraft via Pterodactyl / fallback RCON',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    await initiateBroadcastFlow(ctx, 'mc');
  },
};
