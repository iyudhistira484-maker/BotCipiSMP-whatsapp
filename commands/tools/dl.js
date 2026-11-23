const config = require('../../config');
const {
  fetchTikTokMedia,
  fetchInstagramMedia,
  fetchYouTubeMedia,
} = require('../../lib/api');
const { formatError, mono } = require('../../lib/smallcaps');
const { extractFirstUrl, executeMediaDownload } = require('./_downloader-helper');

module.exports = {
  name: 'dl',
  alias: ['download', 'unduh'],
  category: 'tools',
  description: 'Downloader otomatis cerdas untuk link TikTok, Instagram, atau YouTube',
  cooldown: 6,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const url = extractFirstUrl(ctx);
    const p = config.prefix;

    if (!url) {
      await ctx.reply(
        formatError('Tempel Link Media Yuk', [
          `Kirim link TikTok, Instagram, atau YouTube setelah ${mono(`${p}dl`)} ♡`,
          `Contoh: ${mono(`${p}dl https://vt.tiktok.com/xxxxx`)}`,
        ])
      );
      return;
    }

    if (/tiktok\.com|douyin\.com/i.test(url)) {
      await executeMediaDownload(ctx, {
        platformLabel: 'TikTok',
        exampleCmd: 'dl <link>',
        fetcherFn: (u) => fetchTikTokMedia(u),
      });
      return;
    }

    if (/instagram\.com|instagr\.am/i.test(url)) {
      await executeMediaDownload(ctx, {
        platformLabel: 'Instagram',
        exampleCmd: 'dl <link>',
        fetcherFn: (u) => fetchInstagramMedia(u),
      });
      return;
    }

    if (/youtube\.com|youtu\.be/i.test(url)) {
      const wantMp3 = ctx.args.some((a) => ['mp3', 'audio'].includes(a.toLowerCase()));
      await executeMediaDownload(ctx, {
        platformLabel: wantMp3 ? 'YouTube MP3' : 'YouTube MP4',
        exampleCmd: 'dl <link>',
        fetcherFn: (u) => fetchYouTubeMedia(u, wantMp3 ? 'mp3' : 'mp4'),
      });
      return;
    }

    await ctx.reply(
      formatError('Platform Belum Didukung', [
        'Saat ini downloader mendukung tautan dari TikTok, Instagram, dan YouTube ya kak ♡',
      ])
    );
  },
};
