const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const config = require('../config');
const { fetchWithTimeout } = require('./api');
const { logger } = require('./logger');

const PINK_EMBED_COLOR = 0xff5c97; // #FF5C97 pastel pink kawaii

let discordClient = null;
let discordReady = false;
let bridgeMessageListener = null;
let ticketMessageListener = null;

/**
 * Sanitasi teks Discord:
 * - Cegah mention massal @everyone, @here, dan role ping <@&id>
 * - Batasi panjang teks maksimal
 */
function sanitizeDiscordText(raw = '', maxLen = 300) {
  return String(raw || '')
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere')
    .replace(/<@&\d+>/g, '@\u200brole')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Cek apakah Discord Webhook sudah dikonfigurasi di .env
 */
function isDiscordWebhookConfigured() {
  return Boolean(
    config.discord.webhookUrl &&
      /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(
        config.discord.webhookUrl
      )
  );
}

/**
 * Cek apakah Bot Discord (discord.js) sudah dikonfigurasi di .env
 */
function isDiscordBotConfigured() {
  return Boolean((config.discord.botToken || '').trim());
}

function getDiscordClient() {
  return discordReady ? discordClient : null;
}

function setDiscordBridgeListeners({ onBridgeMessage, onTicketMessage } = {}) {
  if (typeof onBridgeMessage === 'function') bridgeMessageListener = onBridgeMessage;
  if (typeof onTicketMessage === 'function') ticketMessageListener = onTicketMessage;
}

/**
 * Nyalakan klien discord.js untuk Bridge 2 arah & sinkronisasi Tiket
 */
async function startDiscordBot(listeners = {}) {
  setDiscordBridgeListeners(listeners);

  if (!isDiscordBotConfigured()) {
    logger.info('DISCORD', 'DISCORD_BOT_TOKEN belum diisi — mode Webhook satu arah aktif');
    return { started: false, reason: 'unconfigured' };
  }

  if (discordClient) {
    return { started: true, ready: discordReady };
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  discordClient = client;

  client.once(Events.ClientReady, (readyClient) => {
    discordReady = true;
    logger.info('DISCORD', `Bot Discord terhubung sebagai ${readyClient.user.tag} ♡`);
  });

  client.on(Events.Error, (err) => {
    logger.error('DISCORD', 'Kesalahan pada klien discord.js', err);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message || message.author?.bot || message.webhookId || message.system) {
        return;
      }

      const rawContent = String(message.cleanContent || message.content || '').trim();
      const attachmentNote =
        message.attachments?.size > 0 ? ' [lampiran media]' : '';
      const combined = `${rawContent}${attachmentNote}`.trim();
      if (!combined) return;

      const authorName =
        message.member?.displayName ||
        message.author?.globalName ||
        message.author?.username ||
        'DiscordUser';

      // 1. Pesan di Channel Bridge -> teruskan ke WA & Minecraft (abaikan command ber-prefix)
      if (
        config.discord.bridgeChannelId &&
        message.channelId === config.discord.bridgeChannelId &&
        typeof bridgeMessageListener === 'function'
      ) {
        if (
          combined.startsWith(config.prefix || '.') ||
          combined.startsWith('!') ||
          combined.startsWith('/')
        ) {
          return;
        }
        await bridgeMessageListener({
          authorName: sanitizeDiscordText(authorName, 32),
          content: sanitizeDiscordText(
            combined,
            config.bridge?.maxMessageLength || 220
          ),
          messageId: message.id,
        });
        return;
      }

      // 2. Pesan/Balasan Admin di Channel atau Thread Tiket (.lapor Fase 5)
      if (
        typeof ticketMessageListener === 'function' &&
        config.discord.ticketChannelId &&
        (message.channelId === config.discord.ticketChannelId ||
          message.channel?.parentId === config.discord.ticketChannelId)
      ) {
        await ticketMessageListener({
          authorName: sanitizeDiscordText(authorName, 36),
          content: sanitizeDiscordText(combined, 600),
          channelId: message.channelId,
          parentId: message.channel?.parentId || null,
          isThread: Boolean(message.channel?.isThread && message.channel.isThread()),
          referenceMessageId: message.reference?.messageId || null,
        });
      }
    } catch (err) {
      logger.error('DISCORD', 'Gagal memproses pesan masuk Discord', err);
    }
  });

  try {
    await client.login(config.discord.botToken.trim());
    return { started: true };
  } catch (err) {
    logger.error('DISCORD', 'Gagal login discord.js (periksa DISCORD_BOT_TOKEN & Message Content Intent)', err);
    try {
      client.destroy();
    } catch {
      // Abaikan
    }
    discordClient = null;
    discordReady = false;
    return { started: false, reason: err.message };
  }
}

async function stopDiscordBot() {
  discordReady = false;
  if (discordClient) {
    try {
      await discordClient.destroy();
    } catch {
      // Abaikan
    }
    discordClient = null;
  }
}

/**
 * Kirim Embed Pink + Thumbnail Anime Lokal via Discord Webhook (Broadcast Fase 3)
 * Menghormati config.dryRun = true
 */
async function sendDiscordWebhookBroadcast({
  message,
  title = `✿ Pengumuman ${config.botName} ✿`,
  senderLabel = config.ownerName,
  maxLen = config.broadcast?.maxLength || 300,
  color = PINK_EMBED_COLOR,
}) {
  const cleanMsg = sanitizeDiscordText(message, maxLen);
  if (!cleanMsg) {
    return { ok: false, error: 'Pesan kosong setelah sanitasi' };
  }

  const embedPayload = {
    title,
    description: cleanMsg,
    color,
    timestamp: new Date().toISOString(),
    footer: {
      text: `${config.botName} • Oleh ${senderLabel}`,
    },
  };

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      via: 'dry-run (Discord Webhook)',
      embedPreview: embedPayload,
    };
  }

  if (!isDiscordWebhookConfigured()) {
    return {
      ok: false,
      error: 'DISCORD_WEBHOOK_URL belum diisi atau tidak valid di .env',
    };
  }

  const webhookUrl = `${config.discord.webhookUrl}${
    config.discord.webhookUrl.includes('?') ? '&' : '?'
  }wait=true`;

  const mascotPath = path.join(config.paths.assetsDir, 'mascot.png');

  try {
    if (fs.existsSync(mascotPath) && typeof FormData !== 'undefined' && typeof Blob !== 'undefined') {
      const imgBuf = fs.readFileSync(mascotPath);
      const form = new FormData();
      const fullPayload = {
        username: config.botName,
        allowed_mentions: { parse: [] },
        embeds: [
          {
            ...embedPayload,
            thumbnail: { url: 'attachment://mascot.png' },
          },
        ],
      };

      form.append('payload_json', JSON.stringify(fullPayload));
      form.append('files[0]', new Blob([imgBuf], { type: 'image/png' }), 'mascot.png');

      const res = await fetchWithTimeout(
        webhookUrl,
        {
          method: 'POST',
          body: form,
        },
        15000
      );

      if (!res.ok) {
        throw new Error(`Discord Webhook HTTP ${res.status}`);
      }

      return { ok: true, via: 'Discord Webhook (Embed + Thumbnail)' };
    }

    const res = await fetchWithTimeout(
      webhookUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.botName,
          allowed_mentions: { parse: [] },
          embeds: [embedPayload],
        }),
      },
      15000
    );

    if (!res.ok) {
      throw new Error(`Discord Webhook HTTP ${res.status}`);
    }

    return { ok: true, via: 'Discord Webhook (Embed)' };
  } catch (err) {
    logger.error('DISCORD', 'Gagal mengirim pengumuman Discord Webhook', err);
    return {
      ok: false,
      error: err.message,
    };
  }
}

/**
 * Kirim pesan chat Bridge ([WA] atau [MC]) ke Channel Bridge Discord
 * Utamakan discord.js Client, fallback ke DISCORD_WEBHOOK_URL bila bot token kosong
 */
async function sendDiscordBridgeMessage({
  sourceTag = 'WA',
  senderName = 'Member',
  text = '',
}) {
  const safeSender = sanitizeDiscordText(senderName, 36) || 'Member';
  const safeText = sanitizeDiscordText(text, config.bridge?.maxMessageLength || 220);
  if (!safeText) return { ok: false, error: 'Pesan kosong' };

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      via: 'dry-run (Discord Bridge)',
      preview: `[${sourceTag}] ${safeSender}: ${safeText}`,
    };
  }

  // 1. Kirim lewat discord.js bila terhubung & channel bridge diatur
  if (discordReady && discordClient && config.discord.bridgeChannelId) {
    try {
      const ch = await discordClient.channels.fetch(config.discord.bridgeChannelId);
      if (ch && typeof ch.send === 'function') {
        await ch.send({
          content: `**[${sourceTag}] ${safeSender}**: ${safeText}`,
          allowedMentions: { parse: [] },
        });
        return { ok: true, via: 'discord.js' };
      }
    } catch (err) {
      logger.warn('DISCORD:BRIDGE', `Gagal kirim via discord.js (${err.message}), mencoba fallback webhook...`);
    }
  }

  // 2. Fallback ke Webhook Discord bila tersedia
  if (isDiscordWebhookConfigured()) {
    try {
      const res = await fetchWithTimeout(
        config.discord.webhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: `[${sourceTag}] ${safeSender}`.slice(0, 78),
            content: safeText,
            allowed_mentions: { parse: [] },
          }),
        },
        10000
      );
      if (res.ok) {
        return { ok: true, via: 'Discord Webhook' };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: 'Discord Bridge belum dikonfigurasi' };
}

/**
 * Kirim notifikasi status server (Nyala/Mati & Join/Leave) ke Discord
 */
async function sendDiscordStatusNotification({
  title,
  description,
  color = PINK_EMBED_COLOR,
}) {
  const cleanDesc = sanitizeDiscordText(description, 400);
  if (config.dryRun) {
    return { ok: true, dryRun: true, via: 'dry-run' };
  }

  const targetChannelId =
    config.discord.statusChannelId || config.discord.bridgeChannelId;

  if (discordReady && discordClient && targetChannelId) {
    try {
      const ch = await discordClient.channels.fetch(targetChannelId);
      if (ch && typeof ch.send === 'function') {
        const mascotPath = path.join(config.paths.assetsDir, 'mascot.png');
        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(cleanDesc)
          .setColor(color)
          .setTimestamp()
          .setFooter({ text: config.botName });

        const files = [];
        if (fs.existsSync(mascotPath)) {
          files.push(new AttachmentBuilder(mascotPath, { name: 'mascot.png' }));
          embed.setThumbnail('attachment://mascot.png');
        }

        await ch.send({
          embeds: [embed],
          files,
          allowedMentions: { parse: [] },
        });
        return { ok: true, via: 'discord.js (Status Channel)' };
      }
    } catch (err) {
      logger.warn('DISCORD:STATUS', `Gagal kirim status via discord.js: ${err.message}`);
    }
  }

  if (isDiscordWebhookConfigured()) {
    return sendDiscordWebhookBroadcast({
      title,
      message: cleanDesc,
      senderLabel: 'Sistem Otomatis',
      maxLen: 400,
      color,
    });
  }

  return { ok: false, error: 'Discord Status Channel / Webhook belum diatur' };
}

/**
 * Kirim Laporan Tiket Baru (.lapor) ke Channel Admin Discord + Buat Thread Diskusi
 */
async function sendDiscordTicketAlert({
  ticketNo,
  userName,
  userPhone,
  mcUsername = '-',
  category = 'umum',
  subject = 'Laporan Member',
  message = '',
}) {
  const cleanMsg = sanitizeDiscordText(message, 800);
  const cleanSubject = sanitizeDiscordText(subject, 120);
  const cleanUser = sanitizeDiscordText(userName, 40) || 'Member WA';

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      via: 'dry-run (Discord Ticket)',
      channelId: 'dryrun-thread-id',
      messageId: 'dryrun-msg-id',
    };
  }

  const targetChannelId =
    config.discord.ticketChannelId || config.discord.statusChannelId;

  if (discordReady && discordClient && targetChannelId) {
    try {
      const ch = await discordClient.channels.fetch(targetChannelId);
      if (ch && typeof ch.send === 'function') {
        const mascotPath = path.join(config.paths.assetsDir, 'mascot.png');
        const embed = new EmbedBuilder()
          .setTitle(`🎫 Tiket Baru #${ticketNo} — [${category.toUpperCase()}]`)
          .setDescription(
            [
              `**Pelapor:** ${cleanUser} (${userPhone ? `+${userPhone}` : 'WA'})`,
              `**Akun MC:** ${sanitizeDiscordText(mcUsername, 40)}`,
              `**Subjek:** ${cleanSubject}`,
              '',
              '**Isi Laporan:**',
              cleanMsg,
              '',
              `*Balas langsung di thread ini atau ketik \`!balas ${ticketNo} <pesan>\` / \`!tutup ${ticketNo} <solusi>\`*`,
            ].join('\n')
          )
          .setColor(PINK_EMBED_COLOR)
          .setTimestamp()
          .setFooter({ text: `${config.botName} • Sistem Tiket 2 Arah` });

        const files = [];
        if (fs.existsSync(mascotPath)) {
          files.push(new AttachmentBuilder(mascotPath, { name: 'mascot.png' }));
          embed.setThumbnail('attachment://mascot.png');
        }

        const adminRoleId = (config.discord.adminRoleId || '').replace(/[^0-9]/g, '');
        const rolePing = adminRoleId ? `<@&${adminRoleId}>` : '';

        const sentMsg = await ch.send({
          content: rolePing ? `${rolePing} Laporan baru masuk!` : undefined,
          embeds: [embed],
          files,
          allowedMentions: adminRoleId ? { roles: [adminRoleId] } : { parse: [] },
        });

        let threadId = ch.id;
        if (typeof sentMsg.startThread === 'function') {
          try {
            const thread = await sentMsg.startThread({
              name: `${ticketNo} • ${cleanUser}`.slice(0, 90),
              autoArchiveDuration: 1440,
            });
            threadId = thread.id;
          } catch {
            // Jika channel tidak mengizinkan thread, tetap sinkron lewat ID pesan/channel induk
          }
        }

        return {
          ok: true,
          via: 'discord.js (Ticket Channel)',
          channelId: threadId,
          messageId: sentMsg.id,
        };
      }
    } catch (err) {
      logger.warn('DISCORD:TICKET', `Gagal kirim tiket via discord.js: ${err.message}`);
    }
  }

  if (isDiscordWebhookConfigured()) {
    const whRes = await sendDiscordWebhookBroadcast({
      title: `🎫 Tiket #${ticketNo} [${category.toUpperCase()}] — ${cleanUser}`,
      message: `**Subjek:** ${cleanSubject}\n**Akun MC:** ${mcUsername}\n\n${cleanMsg}`,
      senderLabel: cleanUser,
      maxLen: 900,
    });
    return {
      ...whRes,
      channelId: null,
      messageId: null,
    };
  }

  return { ok: false, error: 'Channel Tiket / Webhook Discord belum diatur' };
}

/**
 * Kirim pesan lanjutan / penutupan tiket ke Thread/Channel Discord terkait
 */
async function sendDiscordTicketFollowUp({
  channelId,
  ticketNo,
  senderLabel,
  text,
  isClosure = false,
}) {
  const cleanText = sanitizeDiscordText(text, 600);
  if (!cleanText) return { ok: false };

  if (config.dryRun) {
    return { ok: true, dryRun: true };
  }

  const destId = channelId || config.discord.ticketChannelId;
  if (discordReady && discordClient && destId) {
    try {
      const ch = await discordClient.channels.fetch(destId);
      if (ch && typeof ch.send === 'function') {
        const prefix = isClosure
          ? `🔒 **Tiket #${ticketNo} Ditutup oleh ${sanitizeDiscordText(senderLabel, 36)}:**`
          : `💬 **[${ticketNo}] Balasan ${sanitizeDiscordText(senderLabel, 36)}:**`;
        await ch.send({
          content: `${prefix}\n${cleanText}`,
          allowedMentions: { parse: [] },
        });
        return { ok: true, via: 'discord.js' };
      }
    } catch (err) {
      logger.warn('DISCORD:TICKET', `Gagal kirim follow-up tiket ke Discord: ${err.message}`);
    }
  }

  if (isDiscordWebhookConfigured()) {
    return sendDiscordWebhookBroadcast({
      title: isClosure ? `🔒 Tiket #${ticketNo} Ditutup` : `💬 Balasan Tiket #${ticketNo}`,
      message: cleanText,
      senderLabel,
      maxLen: 600,
    });
  }

  return { ok: false };
}

/**
 * Auto-register untuk loadFeatureModules() di index.js
 */
function register() {
  startDiscordBot().catch((err) =>
    logger.error('DISCORD', 'Gagal inisialisasi awal Discord Bot', err)
  );
  process.once('SIGINT', () => stopDiscordBot());
  process.once('SIGTERM', () => stopDiscordBot());
}

module.exports = {
  PINK_EMBED_COLOR,
  sanitizeDiscordText,
  isDiscordWebhookConfigured,
  isDiscordBotConfigured,
  getDiscordClient,
  setDiscordBridgeListeners,
  startDiscordBot,
  stopDiscordBot,
  sendDiscordWebhookBroadcast,
  sendDiscordBridgeMessage,
  sendDiscordStatusNotification,
  sendDiscordTicketAlert,
  sendDiscordTicketFollowUp,
  register,
};
