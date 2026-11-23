const { fetchYouTubeMedia } = require('../../lib/api');
const { executeMediaDownload } = require('./_downloader-helper');

module.exports = {
  name: 'yt',
  alias: ['ytmp4', 'ytmp3', 'youtube', 'ytdl'],
  category: 'tools',
  description: 'Unduh video MP4 (.yt) atau audio MP3 (.ytmp3) dari YouTube',
  cooldown: 8,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const wantMp3 =
      ctx.commandName === 'ytmp3' ||
      ctx.args.some((a) => ['mp3', 'audio'].includes(a.toLowerCase()));

    await executeMediaDownload(ctx, {
      platformLabel: wantMp3 ? 'YouTube MP3' : 'YouTube MP4',
      exampleCmd: wantMp3
        ? 'ytmp3 https://youtu.be/xxxxx'
        : 'yt https://youtu.be/xxxxx',
      fetcherFn: (url) => fetchYouTubeMedia(url, wantMp3 ? 'mp3' : 'mp4'),
    });
  },
};
