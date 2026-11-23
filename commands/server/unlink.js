const config = require('../../config');
const { unlinkAccount } = require('../../lib/bridge');
const { formatSuccess, formatError, mono, keep } = require('../../lib/smallcaps');

module.exports = {
  name: 'unlink',
  alias: ['lepasakun', 'unbindmc'],
  category: 'server',
  description: 'Lepaskan tautan akun Minecraft dari nomor WhatsApp kamu',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const p = config.prefix;
    const res = unlinkAccount(ctx.senderJid);

    if (!res.ok) {
      await ctx.reply(
        formatError('Belum Ada Akun Tertaut', [
          `Nomor WhatsApp kamu belum terhubung ke akun Minecraft mana pun ♡`,
          `Ketik ${mono(`${p}link <username>`)} untuk menautkan akun ya!`,
        ])
      );
      return;
    }

    await ctx.reply(
      formatSuccess('Tautan Akun Dilepas', [
        `Tautan dengan akun Minecraft ${keep(res.previousUsername)} telah berhasil dilepas ✿`,
        `Kamu bisa menautkan akun lagi kapan saja lewat ${mono(`${p}link <username>`)} ♡`,
      ])
    );
  },
};
