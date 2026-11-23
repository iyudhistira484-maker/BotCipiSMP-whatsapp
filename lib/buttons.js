const crypto = require('crypto');
const config = require('../config');
const { smallcaps, mono } = require('./smallcaps');
const { normalizeUserJid, extractPhoneFromJid } = require('./database');
const { logger } = require('./logger');

let giftedBtns = null;
try {
  giftedBtns = require('gifted-btns');
} catch (err) {
  logger.warn('BUTTONS', `Plugin gifted-btns tidak tersedia (${err.message}), otomatis menggunakan fallback teks`);
}

/**
 * Registri sesi tombol aktif untuk validasi kepemilikan pengirim & kedaluwarsa
 * key: token string ("btn:xxxx")
 * value: { commandText, ownerJid, ownerPhone, isPublic, oneTime, expiresAt, createdAt }
 */
const buttonRegistry = new Map();

/**
 * Bersihkan sesi tombol kedaluwarsa tiap menit agar hemat memori
 */
function cleanupExpiredButtons() {
  const now = Date.now();
  for (const [token, entry] of buttonRegistry.entries()) {
    if (entry.expiresAt <= now) {
      buttonRegistry.delete(token);
    }
  }
}

setInterval(cleanupExpiredButtons, 60 * 1000).unref();

/**
 * Daftarkan aksi tombol dengan batas waktu & kepemilikan user
 */
function registerButtonAction({
  commandText,
  ownerJid = null,
  isPublic = false,
  oneTime = false,
  ttlMs = config.buttons.expireMs || 5 * 60 * 1000,
  meta = {},
}) {
  if (buttonRegistry.size >= (config.buttons.maxTracked || 2000)) {
    cleanupExpiredButtons();
    if (buttonRegistry.size >= (config.buttons.maxTracked || 2000)) {
      const oldestKey = buttonRegistry.keys().next().value;
      buttonRegistry.delete(oldestKey);
    }
  }

  const token = `btn:${crypto.randomBytes(6).toString('hex')}`;
  const normalizedOwner = ownerJid ? normalizeUserJid(ownerJid) : null;
  buttonRegistry.set(token, {
    commandText: String(commandText || '').trim(),
    ownerJid: normalizedOwner,
    ownerPhone: normalizedOwner ? extractPhoneFromJid(normalizedOwner) : '',
    isPublic: Boolean(isPublic),
    oneTime: Boolean(oneTime),
    meta,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });

  return token;
}

/**
 * Konversi definisi tombol ringkas menjadi format nativeFlow interactiveButtons gifted-btns
 * sekaligus membangun daftar petunjuk command untuk fallback teks
 */
function buildInteractiveButtons(buttons = [], sessionOpts = {}) {
  const interactiveButtons = [];
  const fallbackHints = [];

  for (const btn of buttons) {
    if (!btn) continue;

    // 1. Tombol List Kategori (single_select)
    if ((btn.type === 'list' || btn.type === 'single_select') && Array.isArray(btn.sections)) {
      const mappedSections = btn.sections.map((sec) => ({
        title: smallcaps(sec.title || 'Pilihan'),
        rows: (sec.rows || []).map((row) => {
          const cmdText = row.command || row.id || '';
          const token = registerButtonAction({
            commandText: cmdText,
            ownerJid: sessionOpts.ownerJid,
            isPublic: sessionOpts.isPublic,
            oneTime: Boolean(row.oneTime || sessionOpts.oneTime),
            ttlMs: sessionOpts.ttlMs,
          });
          if (cmdText && fallbackHints.length < 8) {
            fallbackHints.push(`◦ ${mono(cmdText)} — ${smallcaps(row.title || '')}`);
          }
          return {
            header: row.header ? smallcaps(row.header) : undefined,
            title: smallcaps(row.title || cmdText),
            description: row.description ? smallcaps(row.description) : undefined,
            id: token,
          };
        }),
      }));

      interactiveButtons.push({
        name: 'single_select',
        buttonParamsJson: JSON.stringify({
          title: smallcaps(btn.title || 'Pilih Menu'),
          sections: mappedSections,
        }),
      });
      continue;
    }

    // 2. Tombol Link URL (cta_url)
    if (btn.type === 'url' && btn.url) {
      interactiveButtons.push({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: smallcaps(btn.text || 'Buka Tautan'),
          url: String(btn.url),
        }),
      });
      fallbackHints.push(`◦ ${smallcaps(btn.text || 'Tautan')}: ${btn.url}`);
      continue;
    }

    // 3. Tombol Salin Kode / IP (cta_copy)
    if (btn.type === 'copy' && btn.copyCode) {
      interactiveButtons.push({
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: smallcaps(btn.text || 'Salin'),
          copy_code: String(btn.copyCode),
        }),
      });
      fallbackHints.push(`◦ ${smallcaps(btn.text || 'Kode')}: ${mono(btn.copyCode)}`);
      continue;
    }

    // 4. Default: Quick Reply Button
    const cmdText = btn.command || btn.id || '';
    if (!cmdText) continue;

    const token = registerButtonAction({
      commandText: cmdText,
      ownerJid: sessionOpts.ownerJid,
      isPublic: sessionOpts.isPublic,
      oneTime: Boolean(btn.oneTime || sessionOpts.oneTime),
      ttlMs: sessionOpts.ttlMs,
      meta: btn.meta || {},
    });

    interactiveButtons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: smallcaps(btn.text || cmdText),
        id: token,
      }),
    });
    fallbackHints.push(`◦ ${mono(cmdText)} — ${smallcaps(btn.text || cmdText)}`);
  }

  return { interactiveButtons, fallbackHints };
}

/**
 * Susun teks fallback lengkap dengan instruksi command manual
 */
function buildFallbackCaption(bodyText, footerText, fallbackHints = [], customFallbackText = '') {
  if (customFallbackText) {
    return smallcaps(customFallbackText);
  }
  const parts = [smallcaps(bodyText || '')];
  if (fallbackHints.length > 0) {
    parts.push('');
    parts.push(`╭─❖ ${smallcaps('aksi cepat (ketik command)')} ❖`);
    for (const hint of fallbackHints) {
      parts.push(`│ ${hint}`);
    }
    parts.push('╰────────────');
  }
  if (footerText) {
    parts.push(smallcaps(footerText));
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Kirim pesan tombol interaktif dengan kartu gambar + fallback otomatis ke foto/teks biasa
 *
 * @param {object} sock Baileys socket
 * @param {string} jid JID tujuan (grup / private)
 * @param {{
 *   title?: string,
 *   text: string,
 *   footer?: string,
 *   image?: Buffer|string|null,
 *   buttons?: Array<object>,
 *   ownerJid?: string|null,
 *   isPublic?: boolean,
 *   oneTime?: boolean,
 *   ttlMs?: number,
 *   fallbackText?: string,
 *   mentions?: string[],
 *   quoted?: object
 * }} opts
 */
async function sendButtons(sock, jid, opts = {}) {
  const {
    title = '',
    text = '',
    footer = config.footer,
    image = null,
    buttons = [],
    ownerJid = null,
    isPublic = false,
    oneTime = false,
    ttlMs = config.buttons.expireMs,
    fallbackText = '',
    mentions = [],
    quoted = undefined,
  } = opts;

  const { interactiveButtons, fallbackHints } = buildInteractiveButtons(buttons, {
    ownerJid,
    isPublic,
    oneTime,
    ttlMs,
  });

  const canUseInteractive =
    Boolean(config.useButtons) &&
    Boolean(giftedBtns?.sendInteractiveMessage) &&
    interactiveButtons.length > 0;

  const normalizedMentions = Array.from(
    new Set((mentions || []).map((m) => normalizeUserJid(m)).filter(Boolean))
  );

  if (canUseInteractive) {
    try {
      const payload = {
        title: title ? smallcaps(title) : undefined,
        text: smallcaps(text),
        footer: footer ? smallcaps(footer) : undefined,
        aimode: Boolean(config.buttons.aiModePrivate),
        interactiveButtons,
      };

      if (image) {
        if (Buffer.isBuffer(image)) {
          payload.image = { buffer: image };
        } else if (typeof image === 'string') {
          payload.image = /^https?:\/\//i.test(image) ? { url: image } : image;
        } else if (typeof image === 'object') {
          payload.image = image;
        }
      }

      if (normalizedMentions.length > 0) {
        payload.contextInfo = { mentionedJid: normalizedMentions };
      }

      // gifted-btns menghilangkan contextInfo.mentionedJid saat menyusun interactiveMessage;
      // sisipkan kembali pada relayMessage agar tag @628xxx berubah menjadi mention kontak biru asli!
      const relaySock =
        normalizedMentions.length > 0 && typeof sock?.relayMessage === 'function'
          ? new Proxy(sock, {
              get(target, prop, receiver) {
                if (prop === 'relayMessage') {
                  return async (targetJid, protoMsg, relayOpts) => {
                    if (protoMsg && typeof protoMsg === 'object') {
                      const attachMentions = (im) => {
                        if (!im || typeof im !== 'object') return;
                        im.contextInfo = {
                          ...(im.contextInfo || {}),
                          mentionedJid: normalizedMentions,
                        };
                      };
                      attachMentions(protoMsg.interactiveMessage);
                      attachMentions(protoMsg.viewOnceMessage?.message?.interactiveMessage);
                      attachMentions(protoMsg.viewOnceMessageV2?.message?.interactiveMessage);
                      attachMentions(protoMsg.ephemeralMessage?.message?.interactiveMessage);
                    }
                    return target.relayMessage(targetJid, protoMsg, relayOpts);
                  };
                }
                const val = Reflect.get(target, prop, receiver);
                return typeof val === 'function' ? val.bind(target) : val;
              },
            })
          : sock;

      const sent = await giftedBtns.sendInteractiveMessage(
        relaySock,
        jid,
        payload,
        quoted ? { quoted } : {}
      );
      return { mode: 'interactive', sent };
    } catch (err) {
      logger.warn(
        'BUTTONS',
        `Pengiriman tombol interaktif gagal (${err.message}), beralih ke fallback teks biasa`
      );
    }
  }

  // Fallback Wajib: kirim kartu gambar + caption dengan petunjuk command teks (atau teks saja bila tanpa gambar)
  const captionText = buildFallbackCaption(text, footer, fallbackHints, fallbackText);

  if (image && Buffer.isBuffer(image)) {
    const sent = await sock.sendMessage(
      jid,
      {
        image,
        caption: captionText,
        mentions: normalizedMentions,
      },
      quoted ? { quoted } : undefined
    );
    return { mode: 'fallback-image', sent };
  }

  const sent = await sock.sendMessage(
    jid,
    {
      text: captionText,
      mentions: normalizedMentions,
    },
    quoted ? { quoted } : undefined
  );
  return { mode: 'fallback-text', sent };
}

/**
 * Buka bungkus pesan bertingkat (ephemeral, viewOnce, dll.) untuk membaca isi sebenarnya
 * @param {object} msgContent
 */
function unwrapMessageContent(msgContent) {
  if (!msgContent || typeof msgContent !== 'object') return null;
  if (msgContent.ephemeralMessage?.message) {
    return unwrapMessageContent(msgContent.ephemeralMessage.message);
  }
  if (msgContent.viewOnceMessage?.message) {
    return unwrapMessageContent(msgContent.viewOnceMessage.message);
  }
  if (msgContent.viewOnceMessageV2?.message) {
    return unwrapMessageContent(msgContent.viewOnceMessageV2.message);
  }
  if (msgContent.documentWithCaptionMessage?.message) {
    return unwrapMessageContent(msgContent.documentWithCaptionMessage.message);
  }
  return msgContent;
}

/**
 * Tangkap ID balasan tombol dari berbagai tipe pesan Baileys:
 * - buttonsResponseMessage
 * - interactiveResponseMessage (nativeFlowResponseMessage)
 * - listResponseMessage
 * - templateButtonReplyMessage
 *
 * @param {object} rawMessage objek msg.message dari Baileys
 * @returns {{ rawId: string, displayText: string, type: string } | null}
 */
function extractButtonResponse(rawMessage) {
  const m = unwrapMessageContent(rawMessage);
  if (!m) return null;

  if (m.buttonsResponseMessage) {
    return {
      rawId: String(m.buttonsResponseMessage.selectedButtonId || '').trim(),
      displayText: String(m.buttonsResponseMessage.selectedDisplayText || '').trim(),
      type: 'buttonsResponseMessage',
    };
  }

  if (m.listResponseMessage) {
    return {
      rawId: String(m.listResponseMessage.singleSelectReply?.selectedRowId || '').trim(),
      displayText: String(m.listResponseMessage.title || '').trim(),
      type: 'listResponseMessage',
    };
  }

  if (m.templateButtonReplyMessage) {
    return {
      rawId: String(m.templateButtonReplyMessage.selectedId || '').trim(),
      displayText: String(m.templateButtonReplyMessage.selectedDisplayText || '').trim(),
      type: 'templateButtonReplyMessage',
    };
  }

  if (m.interactiveResponseMessage) {
    const nf = m.interactiveResponseMessage.nativeFlowResponseMessage;
    if (nf?.paramsJson) {
      try {
        const parsed = JSON.parse(nf.paramsJson);
        const rawId = String(parsed.id || parsed.selectedId || parsed.rowId || '').trim();
        if (rawId) {
          return {
            rawId,
            displayText: String(
              parsed.display_text || m.interactiveResponseMessage.body?.text || ''
            ).trim(),
            type: 'interactiveResponseMessage',
          };
        }
      } catch {
        // Abaikan bila JSON rusak
      }
    }
  }

  return null;
}

/**
 * Validasi klik tombol terhadap kepemilikan user & masa berlaku
 * @param {string} rawId
 * @param {string} senderJid
 * @returns {{
 *   valid: boolean,
 *   reason?: 'expired'|'not_owner'|'unknown',
 *   commandText?: string,
 *   ownerJid?: string,
 *   meta?: object
 * }}
 */
function resolveButtonInteraction(rawId, senderJid) {
  if (!rawId) {
    return { valid: false, reason: 'unknown' };
  }

  // Jika menggunakan token sesi bertanda "btn:"
  if (rawId.startsWith('btn:')) {
    const entry = buttonRegistry.get(rawId);
    if (!entry) {
      return { valid: false, reason: 'expired' };
    }

    if (Date.now() > entry.expiresAt) {
      buttonRegistry.delete(rawId);
      return { valid: false, reason: 'expired' };
    }

    if (!entry.isPublic && entry.ownerJid) {
      const normalizedSender = normalizeUserJid(senderJid);
      const senderPhone = extractPhoneFromJid(normalizedSender);
      const sameJid = normalizedSender === entry.ownerJid;
      const samePhone = Boolean(senderPhone && entry.ownerPhone && senderPhone === entry.ownerPhone);

      if (!sameJid && !samePhone) {
        return {
          valid: false,
          reason: 'not_owner',
          ownerJid: entry.ownerJid,
        };
      }
    }

    if (entry.oneTime) {
      buttonRegistry.delete(rawId);
    }

    return {
      valid: true,
      commandText: entry.commandText,
      ownerJid: entry.ownerJid,
      meta: entry.meta,
    };
  }

  // Bila ID langsung berupa command ber-prefix (kompatibilitas tombol lama)
  if (rawId.startsWith(config.prefix)) {
    return {
      valid: true,
      commandText: rawId,
      meta: {},
    };
  }

  return { valid: false, reason: 'unknown' };
}

module.exports = {
  sendButtons,
  registerButtonAction,
  extractButtonResponse,
  resolveButtonInteraction,
  unwrapMessageContent,
};
