const { fetchTikTokMedia } = require('../../lib/api');
const { executeMediaDownload } = require('./_downloader-helper');

module.exports = {
  name: 'tiktok',
  alias: ['tt', 'ttdl'],
  category: 'tools',
  description: 'Unduh video atau slide foto TikTok tanpa watermark (dengan fallback API)',
  cooldown: 6,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    await executeMediaDownload(ctx, {
      platformLabel: 'TikTok',
      exampleCmd: 'tiktok https://vt.tiktok.com/xxxxx',
      fetcherFn: (url) => fetchTikTokMedia(url),
    });
  },
};
