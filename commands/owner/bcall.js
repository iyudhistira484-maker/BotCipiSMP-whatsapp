const { initiateBroadcastFlow } = require('../../lib/broadcast');

module.exports = {
  name: 'bcall',
  alias: ['broadcastall'],
  category: 'owner',
  description: 'Broadcast pengumuman serentak ke WhatsApp, Minecraft, dan Discord',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    await initiateBroadcastFlow(ctx, 'all');
  },
};
