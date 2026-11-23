const { initiateBroadcastFlow } = require('../../lib/broadcast');

module.exports = {
  name: 'bc',
  alias: ['broadcast', 'bcwa'],
  category: 'owner',
  description: 'Broadcast pengumuman ke seluruh grup WhatsApp (preview + konfirmasi 30d)',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    await initiateBroadcastFlow(ctx, 'wa');
  },
};
