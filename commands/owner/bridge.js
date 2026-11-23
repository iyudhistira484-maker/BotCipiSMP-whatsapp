const config = require('../../config');
const { setSetting, addAuditLog } = require('../../lib/database');
const {
  getEnabledBridgeGroups,
  isWaGroupBridged,
  setWaGroupBridgeState,
  isJoinLeaveNotifyEnabled,
  isServerStatusNotifyEnabled,
  buildBridgePrivacyNotice,
} = require('../../lib/bridge');
const { getPteroStreamState, isPteroConfigured, isRconConfigured } = require('../../lib/ptero');
const { getDiscordClient, isDiscordWebhookConfigured } = require('../../lib/discord');
const {
  renderBox,
  formatSuccess,
  formatError,
  mono,
  keep,
} = require('../../lib/smallcaps');

module.exports = {
  name: 'bridge',
  alias: ['jembatan', 'chatbridge'],
  category: 'owner',
  description: 'Kelola Jembatan Chat 2 Arah WA <-> Minecraft <-> Discord & notifikasi status',
  cooldown: 3,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: true,
  premiumOnly: false,

  async execute(ctx) {
    const { sock, chatJid, senderJid, isGroup, args } = ctx;
    const p = config.prefix;
    const sub = (args[0] || 'status').toLowerCase();

    if (sub === 'on' || sub === 'enable' || sub === 'aktif') {
      if (!isGroup) {
        await ctx.reply(
          formatError('Jalankan di Dalam Grup', [
            `Ketik ${mono(`${p}bridge on`)} langsung di dalam grup WhatsApp yang ingin dijadikan jembatan ya ♡`,
          ])
        );
        return;
      }

      setWaGroupBridgeState(chatJid, true);
      setSetting(`bridge_privacy_notified:${chatJid}`, 'true');

      addAuditLog({
        category: 'bridge',
        actorJid: senderJid,
        target: chatJid,
        action: 'bridge_group_enabled',
      });

      // Kirim konfirmasi + Pemberitahuan Privasi Wajib ke seluruh anggota grup!
      await ctx.reply(
        formatSuccess('Bridge Grup Diaktifkan', [
          `Grup ini sekarang terhubung 2 arah dengan Server Minecraft & Discord ${keep(config.botName)} ♡`,
        ])
      );
      await sock.sendMessage(chatJid, { text: buildBridgePrivacyNotice() });
      return;
    }

    if (sub === 'off' || sub === 'disable' || sub === 'mati') {
      if (!isGroup) {
        await ctx.reply(
          formatError('Jalankan di Dalam Grup', [
            `Ketik ${mono(`${p}bridge off`)} di dalam grup WhatsApp yang ingin diputus dari jembatan ya ♡`,
          ])
        );
        return;
      }

      setWaGroupBridgeState(chatJid, false);
      addAuditLog({
        category: 'bridge',
        actorJid: senderJid,
        target: chatJid,
        action: 'bridge_group_disabled',
      });

      await ctx.reply(
        formatSuccess('Bridge Grup Dinonaktifkan', [
          'Pesan dari grup ini tidak lagi diteruskan ke Minecraft maupun Discord ✿',
        ])
      );
      return;
    }

    if (sub === 'joinleave') {
      const toggle = (args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(toggle)) {
        await ctx.reply(
          formatError('Argumen Kurang', [
            `Gunakan ${mono(`${p}bridge joinleave on`)} atau ${mono(`${p}bridge joinleave off`)} ♡`,
          ])
        );
        return;
      }
      setSetting('bridge_notify_join_leave', toggle === 'on' ? 'true' : 'false');
      await ctx.reply(
        formatSuccess('Notifikasi Join/Leave Diperbarui', [
          `Notifikasi pemain masuk/keluar server sekarang: ${toggle.toUpperCase()} ♡`,
        ])
      );
      return;
    }

    if (sub === 'notifstatus') {
      const toggle = (args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(toggle)) {
        await ctx.reply(
          formatError('Argumen Kurang', [
            `Gunakan ${mono(`${p}bridge notifstatus on`)} atau ${mono(`${p}bridge notifstatus off`)} ♡`,
          ])
        );
        return;
      }
      setSetting('bridge_notify_status', toggle === 'on' ? 'true' : 'false');
      await ctx.reply(
        formatSuccess('Notifikasi Nyala/Mati Diperbarui', [
          `Notifikasi perubahan status server sekarang: ${toggle.toUpperCase()} ♡`,
        ])
      );
      return;
    }

    // Default: tampilkan status lengkap Bridge 3 Platform
    const groups = getEnabledBridgeGroups();
    const pteroState = getPteroStreamState();
    const dcBotOnline = Boolean(getDiscordClient());

    const statusLines = [
      config.dryRun ? '⚠️ Mode Simulasi: DRY-RUN AKTIF' : '',
      `✦ Grup WA Aktif   : ${groups.length} grup${
        isGroup ? ` (Grup ini: ${isWaGroupBridged(chatJid) ? 'AKTIF ✅' : 'NONAKTIF ❌'})` : ''
      }`,
      `✦ Pterodactyl WS  : ${
        pteroState.connected
          ? `Terhubung ✅ (Status MC: ${keep(pteroState.serverState)})`
          : isPteroConfigured()
          ? 'Menyambung / Reconnecting ⏳'
          : 'Belum Diisi ❌'
      }`,
      `✦ Fallback RCON   : ${isRconConfigured() ? 'Siap ✅' : 'Belum Diisi ❌'}`,
      `✦ Discord Bridge  : ${
        dcBotOnline
          ? 'Bot 2 Arah Online ✅'
          : isDiscordWebhookConfigured()
          ? 'Webhook 1 Arah Aktif ⚠️'
          : 'Belum Diisi ❌'
      }`,
      `✦ Notif Join/Leave: ${isJoinLeaveNotifyEnabled() ? 'ON ✅' : 'OFF ❌'}`,
      `✦ Notif Nyala/Mati: ${isServerStatusNotifyEnabled() ? 'ON ✅' : 'OFF ❌'}`,
      '',
      '❖ Pengaturan Cepat:',
      `◦ ${mono(`${p}bridge on`)} / ${mono(`${p}bridge off`)} (di dalam grup WA)`,
      `◦ ${mono(`${p}bridge joinleave on|off`)}`,
      `◦ ${mono(`${p}bridge notifstatus on|off`)}`,
    ].filter(Boolean);

    await ctx.reply(
      renderBox('✿ sᴛᴀᴛᴜs ᴊᴇᴍʙᴀᴛᴀɴ ᴋᴏᴍᴜɴɪᴛᴀs', statusLines, {
        footer: config.footer,
      })
    );
  },
};
