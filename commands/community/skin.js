const crypto = require('crypto');
const config = require('../../config');
const {
  getDb,
  normalizeUserJid,
  normalizeMinecraftUsername,
  extractPhoneFromJid,
} = require('../../lib/database');
const { getVerifiedLinkByJid } = require('../../lib/bridge');
const { renderMinecraftSkinCard } = require('../../lib/card');
const { fetchWithTimeout } = require('../../lib/api');
const { formatError, boldSans, mono, keep, DIVIDER } = require('../../lib/smallcaps');
const { logger } = require('../../lib/logger');

/**
 * Hitung Offline UUID v3 standar Paper/Spigot/Purpur: MD5("OfflinePlayer:<username>")
 */
function computeMinecraftOfflineUuid(username) {
  const md5 = Buffer.from(
    crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
  );
  md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80; // IETF variant
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function formatDashedUuid(rawHex = '') {
  const clean = String(rawHex || '').replace(/-/g, '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) return clean;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20, 32)}`;
}

async function tryFetchBuffer(url, timeoutMs = 4200) {
  if (config.dryRun) return null;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'image/png,image/*' } }, timeoutMs);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 100 ? buf : null;
  } catch {
    return null;
  }
}

async function resolveMinecraftSkinData(rawUsername) {
  const isBedrockPrefix = String(rawUsername || '').startsWith('.');
  const cleanGamertag = String(rawUsername || '').replace(/^\.+/, '');
  let displayUsername = rawUsername;
  let edition = isBedrockPrefix ? 'Bedrock (Geyser)' : 'Java Edition';
  let officialUuid = '';
  let textureStatus = 'Preset Karakter CipiSMP';
  let downloadSkinUrl = '';
  let bodyBuffer = null;
  let headBuffer = null;

  if (!config.dryRun) {
    if (isBedrockPrefix) {
      // Coba GeyserMC Global API untuk akun Xbox/Bedrock
      try {
        const xuidRes = await fetchWithTimeout(
          `https://api.geysermc.org/v2/xbox/xuid/${encodeURIComponent(cleanGamertag)}`,
          { headers: { Accept: 'application/json' } },
          4000
        );
        if (xuidRes.ok) {
          const xuidData = await xuidRes.json();
          if (xuidData?.xuid) {
            officialUuid = `XUID: ${xuidData.xuid}`;
            const skinRes = await fetchWithTimeout(
              `https://api.geysermc.org/v2/skin/${encodeURIComponent(String(xuidData.xuid))}`,
              { headers: { Accept: 'application/json' } },
              4000
            );
            if (skinRes.ok) {
              const skinJson = await skinRes.json();
              if (skinJson?.texture_id) {
                textureStatus = 'Bedrock Xbox (GeyserMC)';
                downloadSkinUrl = `https://textures.minecraft.net/texture/${skinJson.texture_id}`;
                [bodyBuffer, headBuffer] = await Promise.all([
                  tryFetchBuffer(`https://mc-heads.net/body/${skinJson.texture_id}/360`),
                  tryFetchBuffer(`https://mc-heads.net/avatar/${skinJson.texture_id}/128`),
                ]);
              }
            }
          }
        }
      } catch {
        // Lanjut ke fallback lokal bila API Geyser lambat
      }
    } else {
      // Coba Mojang API resmi untuk akun Java
      try {
        const mojRes = await fetchWithTimeout(
          `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(cleanGamertag)}`,
          { headers: { Accept: 'application/json' } },
          4000
        );
        if (mojRes.ok) {
          const moj = await mojRes.json();
          if (moj?.id) {
            displayUsername = moj.name || displayUsername;
            officialUuid = formatDashedUuid(moj.id);
            textureStatus = 'Mojang Resmi (Java)';
            downloadSkinUrl = `https://mc-heads.net/download/${moj.id}`;
            [bodyBuffer, headBuffer] = await Promise.all([
              tryFetchBuffer(`https://mc-heads.net/body/${moj.id}/360`),
              tryFetchBuffer(`https://mc-heads.net/avatar/${moj.id}/128`),
            ]);
          } else {
            edition = 'CipiSMP Offline / Cracked';
          }
        } else {
          edition = 'CipiSMP Offline / Cracked';
        }
      } catch {
        edition = 'CipiSMP Offline / Cracked';
      }
    }
  }

  return {
    displayUsername,
    edition,
    officialUuid,
    offlineUuid: computeMinecraftOfflineUuid(displayUsername),
    textureStatus,
    downloadSkinUrl,
    bodyBuffer,
    headBuffer,
  };
}

module.exports = {
  name: 'skin',
  alias: ['mcskin', 'cekskin', 'headmc'],
  category: 'community',
  description: 'Lihat kartu 3D skin, UUID resmi/offline, & status akun player Minecraft CipiSMP',
  cooldown: 5,
  groupOnly: false,
  adminOnly: false,
  ownerOnly: false,
  premiumOnly: false,

  async execute(ctx) {
    const {
      sock,
      msg,
      chatJid,
      senderJid,
      args,
      mentionedJids,
      quotedSenderJid,
    } = ctx;
    const p = config.prefix || '.';

    let targetMcName = '';

    // 1. Jika mention atau reply teman, cek akun MC tertaut milik teman tersebut
    const targetJid =
      (Array.isArray(mentionedJids) && mentionedJids[0]) ||
      quotedSenderJid ||
      (args.length === 0 ? senderJid : null);

    if (targetJid && (args.length === 0 || String(args[0] || '').startsWith('@'))) {
      const link = getVerifiedLinkByJid(normalizeUserJid(targetJid));
      if (link?.mc_username) {
        targetMcName = link.mc_username;
      }
    }

    // 2. Jika user mengetik username MC langsung (.skin Yudhis / .skin .BedrockName)
    if (!targetMcName && args.length >= 1 && !String(args[0] || '').startsWith('@')) {
      const parsed = normalizeMinecraftUsername(args[0]);
      if (!parsed.valid) {
        await ctx.reply(
          formatError('Username Minecraft Tidak Valid', [
            'Gunakan huruf, angka, garis bawah (3–16 karakter), atau awalan titik untuk Bedrock.',
            `Contoh: ${mono(`${p}skin Notch`)} atau ${mono(`${p}skin .PlayerBedrock`)}`,
          ])
        );
        return;
      }
      targetMcName = parsed.display || parsed.raw;
    }

    if (!targetMcName) {
      await ctx.reply(
        formatError('Username Belum Disebutkan', [
          `Ketik ${mono(`${p}skin <username_mc>`)} (contoh: ${mono(`${p}skin Yudhis`)}).`,
          `Atau tautkan akunmu lewat ${mono(`${p}link`)} agar cukup ketik ${mono(`${p}skin`)} saja!`,
        ])
      );
      return;
    }

    try {
      // Cek apakah username ini tertaut ke member WhatsApp CipiSMP di SQLite (tabel links)
      let linkedTag = '';
      try {
        const row = getDb().get(
          "SELECT jid, is_bedrock FROM links WHERE LOWER(mc_username) = LOWER(?) AND status = 'verified' LIMIT 1",
          [targetMcName]
        );
        if (row?.jid) {
          const phone = extractPhoneFromJid(row.jid);
          linkedTag = phone ? `+${phone} (Terverifikasi)` : 'Member Terverifikasi';
        }
      } catch {
        // Abaikan bila belum ada kecocokan
      }

      const skinData = await resolveMinecraftSkinData(targetMcName);
      const cardPng = await renderMinecraftSkinCard({
        username: skinData.displayUsername,
        edition: skinData.edition,
        officialUuid: skinData.officialUuid,
        offlineUuid: skinData.offlineUuid,
        linkedTag,
        textureStatus: skinData.textureStatus,
        bodyBuffer: skinData.bodyBuffer,
        headBuffer: skinData.headBuffer,
      });

      const captionLines = [
        `🧱 *${boldSans('SKIN PLAYER')}:* ${mono(skinData.displayUsername)}`,
        DIVIDER,
        `• Edisi : *${skinData.edition}*`,
        skinData.officialUuid ? `• UUID Resmi : ${mono(skinData.officialUuid)}` : '',
        `• Offline UUID : ${mono(skinData.offlineUuid)}`,
        linkedTag ? `• Member CipiSMP : *Terverifikasi*` : '',
        skinData.downloadSkinUrl ? `• Unduh PNG : ${skinData.downloadSkinUrl}` : '',
      ].filter(Boolean);

      await sock.sendMessage(
        chatJid,
        {
          image: cardPng,
          caption: captionLines.join('\n'),
        },
        { quoted: msg }
      );
    } catch (err) {
      logger.error('CMD:SKIN', 'Gagal memuat kartu .skin', err);
      await ctx.reply(
        formatError('Gagal Memuat Skin Minecraft', [
          `Detail: ${keep(err.message)}`,
        ])
      );
    }
  },
};
