const { initiateBroadcastFlow } = require('../../lib/broadcast');

module.exports = {
  name: 'bcdc',
  alias: ['broadcastdc'],
  category: 'owner',
  description: 'Broadcast pengumuman ke Discord via Webhook (Embed pink + thumbnail anime)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    await initiateBroadcastFlow(ctx, 'dc');
  },
};
