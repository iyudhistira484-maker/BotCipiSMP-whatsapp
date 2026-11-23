const { fetchInstagramMedia } = require('../../lib/api');
const { executeMediaDownload } = require('./_downloader-helper');

module.exports = {
  name: 'ig',
  alias: ['igdl', 'instagram', 'reels'],
  category: 'tools',
  description: 'Unduh video Reels atau foto postingan Instagram (dengan fallback API)',
  cooldown: 6,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    await executeMediaDownload(ctx, {
      platformLabel: 'Instagram',
      exampleCmd: 'ig https://www.instagram.com/reel/xxxxx',
      fetcherFn: (url) => fetchInstagramMedia(url),
    });
  },
};
