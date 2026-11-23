const crypto = require('crypto');
const cron = require('node-cron');
const config = require('../config');
const {
  getDb,
  ensureUser,
  normalizeUserJid,
  extractPhoneFromJid,
  formatMentionTag,
  addXp,
  addAuditLog,
} = require('./database');
const { addBalance } = require('./economy');
const { getEnabledBridgeGroups, getVerifiedLinkByJid } = require('./bridge');
const { sendMinecraftBroadcast } = require('./ptero');
const {
  setDiscordBridgeListeners,
  sendDiscordStatusNotification,
  sendDiscordTicketAlert,
  sendDiscordTicketFollowUp,
} = require('./discord');
const {
  renderBox,
  formatSuccess,
  keep,
  mono,
} = require('./smallcaps');
const {
  getWibDateKey,
  getWibParts,
  formatNumber,
  logger,
} = require('./logger');

let activeWaSock = null;
let giveawaySweepTimer = null;
let midnightQuestTask = null;
const giveawayTimers = new Map(); // giveawayCode -> Timeout
const recurringCronJobs = new Map(); // eventCode -> ScheduledTask

// =====================================================================
// HELPER PARSING DURASI & JADWAL WAKTU WIB
// =====================================================================

/**
 * Parse teks durasi ramah manusia: "30s", "15m", "2j"/"2h", "1hari"/"1d"
 * @returns {number|null} milidetik
 */
function parseDurationMs(raw = '') {
  const m = /^(\d+)\s*(s|d|dtk|detik|m|mnt|menit|h|j|jam|hari|day)$/i.exec(
    String(raw || '').trim()
  );
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = m[2].toLowerCase();

  if (['s', 'dtk', 'detik'].includes(unit)) return val * 1000;
  if (['m', 'mnt', 'menit'].includes(unit)) return val * 60 * 1000;
  if (['h', 'j', 'jam'].includes(unit)) return val * 60 * 60 * 1000;
  if (['d', 'hari', 'day'].includes(unit)) return val * 24 * 60 * 60 * 1000;
  return null;
}

const INDONESIAN_DAYS = Object.freeze({
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
});

/**
 * Parse jadwal event dalam WIB:
 * - Sekali jalan : "sekali 2026-11-25 19:30" atau "2026-11-25 19:30"
 * - Harian WIB   : "harian 19:30" -> cron "30 19 * * *"
 * - Mingguan WIB : "mingguan sabtu 20:00" -> cron "0 20 * * 6"
 * - Cron langsung: "cron 0 20 * * 6" atau "0 20 * * 6"
 */
function parseEventScheduleInput(rawSchedule = '') {
  const s = String(rawSchedule || '')
    .replace(/\s+/g, ' ')
    .replace(/^(\d{1,2})\.(\d{2})$/, '$1:$2')
    .trim();
  if (!s) return { valid: false, reason: 'Jadwal kosong' };

  // 0a. Format super mudah: hanya jam "HH:MM" (otomatis hari ini WIB, atau besok jika jam sudah lewat)
  const timeOnlyMatch = /^(?:hari\s*ini\s+)?(\d{1,2})[:.](\d{2})$/i.exec(s);
  if (timeOnlyMatch) {
    const hhNum = Number(timeOnlyMatch[1]);
    const mmNum = Number(timeOnlyMatch[2]);
    if (hhNum > 23 || mmNum > 59) {
      return { valid: false, reason: 'Jam harus antara 00:00 s/d 23:59 WIB' };
    }
    const hh = String(hhNum).padStart(2, '0');
    const mm = String(mmNum).padStart(2, '0');
    const todayWib = getWibDateKey(new Date());
    let ts = Date.parse(`${todayWib}T${hh}:${mm}:00+07:00`);
    let dateLabel = todayWib;
    if (ts <= Date.now() + 10000) {
      const tomorrowWib = getWibDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
      ts = Date.parse(`${tomorrowWib}T${hh}:${mm}:00+07:00`);
      dateLabel = `${tomorrowWib} (Besok)`;
    }
    return {
      valid: true,
      isRecurring: false,
      runAt: ts,
      cronExpr: null,
      humanLabel: `Sekali pada ${dateLabel} ${hh}:${mm} WIB`,
    };
  }

  // 0b. Format "besok HH:MM" atau "lusa HH:MM"
  const relDayMatch = /^(besok|lusa)\s+(\d{1,2})[:.](\d{2})$/i.exec(s);
  if (relDayMatch) {
    const daysAhead = relDayMatch[1].toLowerCase() === 'lusa' ? 2 : 1;
    const hhNum = Number(relDayMatch[2]);
    const mmNum = Number(relDayMatch[3]);
    if (hhNum > 23 || mmNum > 59) {
      return { valid: false, reason: 'Jam harus antara 00:00 s/d 23:59 WIB' };
    }
    const hh = String(hhNum).padStart(2, '0');
    const mm = String(mmNum).padStart(2, '0');
    const targetDate = getWibDateKey(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));
    const ts = Date.parse(`${targetDate}T${hh}:${mm}:00+07:00`);
    return {
      valid: true,
      isRecurring: false,
      runAt: ts,
      cronExpr: null,
      humanLabel: `Sekali pada ${targetDate} ${hh}:${mm} WIB`,
    };
  }

  // 0c. Format tanggal Indonesia "DD/MM HH:MM" atau "DD-MM-YYYY HH:MM"
  const idDateMatch = /^(?:sekali\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\s+(\d{1,2})[:.](\d{2})$/i.exec(s);
  if (idDateMatch) {
    const dd = String(Number(idDateMatch[1])).padStart(2, '0');
    const mo = String(Number(idDateMatch[2])).padStart(2, '0');
    const curYear = Number(getWibDateKey().slice(0, 4));
    let yyyy = idDateMatch[3] ? Number(idDateMatch[3]) : curYear;
    const hh = String(Number(idDateMatch[4])).padStart(2, '0');
    const mm = String(Number(idDateMatch[5])).padStart(2, '0');
    let ts = Date.parse(`${yyyy}-${mo}-${dd}T${hh}:${mm}:00+07:00`);
    if (!idDateMatch[3] && !Number.isNaN(ts) && ts <= Date.now()) {
      yyyy += 1;
      ts = Date.parse(`${yyyy}-${mo}-${dd}T${hh}:${mm}:00+07:00`);
    }
    if (Number.isNaN(ts) || ts <= Date.now() + 5000) {
      return { valid: false, reason: 'Tanggal atau jam WIB tidak valid / sudah lewat' };
    }
    return {
      valid: true,
      isRecurring: false,
      runAt: ts,
      cronExpr: null,
      humanLabel: `Sekali pada ${yyyy}-${mo}-${dd} ${hh}:${mm} WIB`,
    };
  }

  // 1. Format "sekali YYYY-MM-DD HH:MM" atau langsung "YYYY-MM-DD HH:MM"
  const onceMatch = /^(?:sekali\s+)?(\d{4}-\d{2}-\d{2})\s+(\d{1,2})[:.](\d{2})$/i.exec(s);
  if (onceMatch) {
    const [, datePart, hhRaw, mmRaw] = onceMatch;
    const hh = String(Number(hhRaw)).padStart(2, '0');
    const mm = String(Number(mmRaw)).padStart(2, '0');
    // Zona waktu WIB eksplisit +07:00
    const ts = Date.parse(`${datePart}T${hh}:${mm}:00+07:00`);
    if (Number.isNaN(ts)) {
      return { valid: false, reason: 'Tanggal atau jam WIB tidak valid' };
    }
    if (ts <= Date.now() + 5000) {
      return { valid: false, reason: 'Waktu event sekali jalan harus berada di masa depan (WIB)' };
    }
    return {
      valid: true,
      isRecurring: false,
      runAt: ts,
      cronExpr: null,
      humanLabel: `Sekali pada ${datePart} ${hh}:${mm} WIB`,
    };
  }

  // 2. Format "harian HH:MM" atau "tiap hari HH:MM"
  const dailyMatch = /^(?:harian|tiap\s*hari|setiap\s*hari)\s+(\d{1,2})[:.](\d{2})$/i.exec(s);
  if (dailyMatch) {
    const hh = Number(dailyMatch[1]);
    const mm = Number(dailyMatch[2]);
    if (hh > 23 || mm > 59) {
      return { valid: false, reason: 'Jam harian harus antara 00:00 s/d 23:59 WIB' };
    }
    const expr = `${mm} ${hh} * * *`;
    return {
      valid: true,
      isRecurring: true,
      runAt: null,
      cronExpr: expr,
      humanLabel: `Setiap Hari pukul ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} WIB`,
    };
  }

  // 3. Format "mingguan <hari> HH:MM" ATAU langsung "<hari> HH:MM" (misal: "sabtu 20:00")
  const weeklyMatch = /^(?:(?:mingguan|tiap|setiap)\s+)?([a-zA-Z']+)\s+(\d{1,2})[:.](\d{2})$/i.exec(s);
  if (weeklyMatch) {
    const dayKey = weeklyMatch[1].toLowerCase();
    const dow = INDONESIAN_DAYS[dayKey];
    const hh = Number(weeklyMatch[2]);
    const mm = Number(weeklyMatch[3]);
    if (dow !== undefined && hh <= 23 && mm <= 59) {
      const expr = `${mm} ${hh} * * ${dow}`;
      return {
        valid: true,
        isRecurring: true,
        runAt: null,
        cronExpr: expr,
        humanLabel: `Setiap ${dayKey.charAt(0).toUpperCase() + dayKey.slice(1)} pukul ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} WIB`,
      };
    }
    if (s.toLowerCase().startsWith('mingguan ')) {
      return {
        valid: false,
        reason: 'Gunakan nama hari (senin..minggu) dan jam valid, contoh: sabtu 20:00',
      };
    }
  }

  // 4. Ekspresi node-cron langsung ("cron 0 20 * * 6" atau "0 20 * * 6")
  const rawCron = s.replace(/^cron\s+/i, '').trim();
  if (cron.validate(rawCron)) {
    return {
      valid: true,
      isRecurring: true,
      runAt: null,
      cronExpr: rawCron,
      humanLabel: `Cron WIB (${rawCron})`,
    };
  }

  return {
    valid: false,
    reason:
      'Contoh jadwal mudah: "20:00", "besok 19:30", "harian 19:00", "sabtu 20:00", atau "28/11 19:30".',
  };
}

// =====================================================================
// 1. GIVEAWAY BERDURASI DENGAN PEMENANG OTOMATIS
// =====================================================================

function pickRandomUnique(arr, count) {
  const pool = [...arr];
  const chosen = [];
  const limit = Math.min(pool.length, Math.max(1, count));
  for (let i = 0; i < limit; i += 1) {
    const idx = crypto.randomInt(0, pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}

function scheduleGiveawayTimer(code, endsAt) {
  const prev = giveawayTimers.get(code);
  if (prev) clearTimeout(prev);

  const delayMs = Math.max(250, endsAt - Date.now());
  // Batasi setTimeout tunggal maks 12 jam (sisanya ditangani sweeper tiap 15 detik)
  if (delayMs > 12 * 60 * 60 * 1000) return;

  const timer = setTimeout(() => {
    giveawayTimers.delete(code);
    finishGiveaway(code).catch((err) =>
      logger.error('GIVEAWAY', `Gagal mengundi giveaway ${code}`, err)
    );
  }, delayMs);

  if (typeof timer.unref === 'function') timer.unref();
  giveawayTimers.set(code, timer);
}

/**
 * Buat Giveaway baru di dalam grup (atau global)
 */
function createGiveaway({
  hostRawJid,
  groupJid,
  durationMs,
  winnerCount = 1,
  prizeAmount = 0,
  prizeLabel = 'Hadiah Spesial CipiSMP',
}) {
  const hostJid = normalizeUserJid(hostRawJid);
  const code = `GW-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const now = Date.now();
  const endsAt = now + durationMs;
  const cleanWinners = Math.min(20, Math.max(1, Number(winnerCount || 1)));
  const cleanCoins = Math.max(0, Math.floor(Number(prizeAmount || 0)));

  getDb().run(
    `INSERT INTO giveaways (
       code, title, prize, prize_amount, winner_count, host_jid, group_jid, status, ends_at, participants_json, winners_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, '[]', '[]', ?)`,
    [
      code,
      `Giveaway ${config.botName}`,
      prizeLabel.slice(0, 160),
      cleanCoins,
      cleanWinners,
      hostJid,
      groupJid || null,
      endsAt,
      now,
    ]
  );

  scheduleGiveawayTimer(code, endsAt);

  addAuditLog({
    category: 'giveaway',
    actorJid: hostJid,
    target: code,
    action: 'created',
    details: { prizeLabel, cleanCoins, cleanWinners, endsAt, groupJid },
  });

  return {
    code,
    prizeLabel,
    prizeAmount: cleanCoins,
    winnerCount: cleanWinners,
    endsAt,
    groupJid,
  };
}

/**
 * Daftarkan peserta ke Giveaway aktif (.ikut [kode] atau tombol publik)
 */
function joinGiveaway(participantRawJid, groupJid = null, codeInput = '') {
  const jid = normalizeUserJid(participantRawJid);
  ensureUser(jid);
  const db = getDb();

  return db.transaction(() => {
    let row = null;
    if (codeInput) {
      row = db.get('SELECT * FROM giveaways WHERE UPPER(code) = ?', [
        String(codeInput).trim().toUpperCase(),
      ]);
    } else if (groupJid) {
      row = db.get(
        "SELECT * FROM giveaways WHERE group_jid = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
        [groupJid]
      );
    }
    if (!row && !codeInput) {
      row = db.get(
        "SELECT * FROM giveaways WHERE status = 'active' ORDER BY id DESC LIMIT 1"
      );
    }

    if (!row) {
      return { ok: false, reason: 'not_found' };
    }
    if (row.status !== 'active' || Number(row.ends_at) <= Date.now()) {
      return { ok: false, reason: 'already_ended', code: row.code };
    }
    if (row.group_jid && groupJid && row.group_jid !== groupJid) {
      return { ok: false, reason: 'wrong_group', code: row.code };
    }

    let list = [];
    try {
      list = JSON.parse(row.participants_json || '[]');
    } catch {
      list = [];
    }

    if (list.includes(jid)) {
      return {
        ok: false,
        reason: 'already_joined',
        code: row.code,
        totalParticipants: list.length,
        endsAt: Number(row.ends_at),
      };
    }

    list.push(jid);
    db.run('UPDATE giveaways SET participants_json = ? WHERE id = ?', [
      JSON.stringify(list),
      row.id,
    ]);

    return {
      ok: true,
      code: row.code,
      prize: row.prize,
      prizeAmount: Number(row.prize_amount || 0),
      totalParticipants: list.length,
      endsAt: Number(row.ends_at),
    };
  });
}

/**
 * Selesaikan Giveaway, undi pemenang secara acak adil, salurkan koin bonus, & umumkan ke grup!
 */
async function finishGiveaway(codeInput) {
  const db = getDb();
  const code = String(codeInput || '').trim().toUpperCase();

  const timer = giveawayTimers.get(code);
  if (timer) {
    clearTimeout(timer);
    giveawayTimers.delete(code);
  }

  const outcome = db.transaction(() => {
    const row = db.get('SELECT * FROM giveaways WHERE UPPER(code) = ?', [code]);
    if (!row || row.status !== 'active') {
      return null;
    }

    let participants = [];
    try {
      participants = JSON.parse(row.participants_json || '[]');
    } catch {
      participants = [];
    }

    const winners =
      participants.length > 0
        ? pickRandomUnique(participants, Number(row.winner_count || 1))
        : [];

    db.run(
      "UPDATE giveaways SET status = 'ended', winners_json = ? WHERE id = ?",
      [JSON.stringify(winners), row.id]
    );

    return {
      row,
      participants,
      winners,
    };
  });

  if (!outcome) return { ok: false, reason: 'not_active' };

  const { row, participants, winners } = outcome;
  const coinBonus = Number(row.prize_amount || 0);

  if (coinBonus > 0 && winners.length > 0) {
    for (const wJid of winners) {
      addBalance(wJid, coinBonus);
    }
  }

  addAuditLog({
    category: 'giveaway',
    actorJid: row.host_jid,
    target: row.code,
    action: 'finished',
    details: {
      totalParticipants: participants.length,
      winners,
      coinBonus,
    },
  });

  // Susun pengumuman pemenang
  let announceText = '';
  if (winners.length === 0) {
    announceText = renderBox(
      `✿ ɢɪᴠᴇᴀᴡᴀʏ ${keep(row.code)} sᴇʟᴇsᴀɪ`,
      [
        `✦ Hadiah  : ${keep(row.prize)}`,
        '✦ Peserta : 0 petualang',
        '◦ Sayang sekali belum ada peserta yang mendaftar pada sesi ini ♡',
      ],
      { footer: config.footer }
    );
  } else {
    const winnerTags = winners.map(
      (j, idx) => `  ${idx + 1}. ${formatMentionTag(j)}`
    );
    announceText = renderBox(
      `🎉 ᴘᴇᴍᴇɴᴀɴɢ ɢɪᴠᴇᴀᴡᴀʏ ${keep(row.code)}`,
      [
        `✦ Hadiah       : ${keep(row.prize)}`,
        coinBonus > 0
          ? `✦ Bonus Otomatis: +${formatNumber(coinBonus)} ${config.economy.currencyName} / pemenang`
          : '',
        `✦ Total Peserta: ${formatNumber(participants.length)} petualang`,
        '',
        '❖ Selamat kepada Pemenang:',
        ...winnerTags,
        '',
        '◦ Hubungi Admin/Host untuk klaim hadiah non-koin ya ♡',
      ].filter(Boolean),
      { footer: config.footer }
    );
  }

  if (activeWaSock && row.group_jid && !config.dryRun) {
    try {
      await activeWaSock.sendMessage(row.group_jid, {
        text: announceText,
        mentions: winners,
      });
    } catch (err) {
      logger.warn('GIVEAWAY', `Gagal mengirim pengumuman pemenang ${row.code}: ${err.message}`);
    }
  }

  return {
    ok: true,
    code: row.code,
    prize: row.prize,
    prizeAmount: coinBonus,
    participantsCount: participants.length,
    winners,
    announcementText: announceText,
  };
}

/**
 * Undi ulang 1 pemenang pengganti (.giveaway reroll <kode>)
 */
function rerollGiveaway(codeInput) {
  const db = getDb();
  const code = String(codeInput || '').trim().toUpperCase();
  const row = db.get('SELECT * FROM giveaways WHERE UPPER(code) = ?', [code]);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'ended') return { ok: false, reason: 'not_ended' };

  const participants = JSON.parse(row.participants_json || '[]');
  const prevWinners = JSON.parse(row.winners_json || '[]');
  const remainingPool = participants.filter((p) => !prevWinners.includes(p));
  const poolToDraw = remainingPool.length > 0 ? remainingPool : participants;

  if (poolToDraw.length === 0) {
    return { ok: false, reason: 'no_participants' };
  }

  const [newWinner] = pickRandomUnique(poolToDraw, 1);
  const updatedWinners = [...prevWinners, newWinner];
  db.run('UPDATE giveaways SET winners_json = ? WHERE id = ?', [
    JSON.stringify(updatedWinners),
    row.id,
  ]);

  return {
    ok: true,
    code: row.code,
    prize: row.prize,
    newWinner,
  };
}

function cancelGiveaway(codeInput) {
  const db = getDb();
  const code = String(codeInput || '').trim().toUpperCase();
  const row = db.get("SELECT * FROM giveaways WHERE UPPER(code) = ? AND status = 'active'", [
    code,
  ]);
  if (!row) return { ok: false, reason: 'not_found' };

  const timer = giveawayTimers.get(row.code);
  if (timer) {
    clearTimeout(timer);
    giveawayTimers.delete(row.code);
  }
  db.run("UPDATE giveaways SET status = 'cancelled' WHERE id = ?", [row.id]);
  return { ok: true, code: row.code, prize: row.prize };
}

function listActiveGiveaways(groupJid = null) {
  const db = getDb();
  if (groupJid) {
    return db.all(
      "SELECT * FROM giveaways WHERE status = 'active' AND (group_jid = ? OR group_jid IS NULL) ORDER BY ends_at ASC",
      [groupJid]
    );
  }
  return db.all("SELECT * FROM giveaways WHERE status = 'active' ORDER BY ends_at ASC");
}

async function sweepDueGiveaways() {
  const dueRows = getDb().all(
    "SELECT code, ends_at FROM giveaways WHERE status = 'active'"
  );
  const now = Date.now();
  for (const r of dueRows) {
    if (Number(r.ends_at) <= now) {
      await finishGiveaway(r.code);
    } else if (!giveawayTimers.has(r.code)) {
      scheduleGiveawayTimer(r.code, Number(r.ends_at));
    }
  }
}

// =====================================================================
// 2. EVENT TERJADWAL SEKALI & BERULANG VIA NODE-CRON (WIB)
// =====================================================================

async function fireScheduledEvent(eventRow) {
  if (!eventRow) return { ok: false };

  let platforms = ['wa', 'discord', 'minecraft'];
  let targetGroups = [];
  try {
    platforms = JSON.parse(eventRow.platforms_json || '["wa","discord","minecraft"]');
  } catch {
    platforms = ['wa', 'discord', 'minecraft'];
  }
  try {
    targetGroups = JSON.parse(eventRow.target_groups_json || '[]');
  } catch {
    targetGroups = [];
  }

  const now = Date.now();
  getDb().run(
    'UPDATE events SET last_run_at = ?, active = ? WHERE id = ?',
    [now, eventRow.is_recurring ? 1 : 0, eventRow.id]
  );

  const waGroups =
    targetGroups.length > 0 ? targetGroups : getEnabledBridgeGroups();

  const alertBox = renderBox(
    `✿ ᴘᴇɴɢɪɴɢᴀᴛ ᴇᴠᴇɴᴛ • ${keep(eventRow.title)}`,
    [
      `✦ Event  : ${keep(eventRow.title)}`,
      eventRow.description ? `✦ Detail : ${keep(eventRow.description)}` : '',
      `✦ Server : ${keep(config.minecraft.host)}`,
      '◦ Yuk segera bersiap dan ramaikan bareng warga CipiSMP ♡',
    ].filter(Boolean),
    { footer: config.footer }
  );

  const tasks = [];

  if (platforms.includes('wa') && activeWaSock && !config.dryRun) {
    for (const gJid of waGroups) {
      tasks.push(
        activeWaSock.sendMessage(gJid, { text: alertBox }).catch((err) =>
          logger.warn('EVENT:WA', `Gagal kirim pengingat event ke ${gJid}: ${err.message}`)
        )
      );
    }
  }

  if (platforms.includes('minecraft')) {
    tasks.push(
      sendMinecraftBroadcast(
        `[EVENT] ${eventRow.title} — ${eventRow.description || 'Yuk kumpul sekarang!'}`,
        '✿ Event'
      )
    );
  }

  if (platforms.includes('discord')) {
    tasks.push(
      sendDiscordStatusNotification({
        title: `🎉 Event Komunitas: ${eventRow.title}`,
        description:
          eventRow.description ||
          `Event **${eventRow.title}** sedang berlangsung di **${config.minecraft.host}**!`,
        color: 0xff5c97,
      })
    );
  }

  await Promise.allSettled(tasks);

  addAuditLog({
    category: 'event',
    actorJid: 'scheduler',
    target: eventRow.code,
    action: config.dryRun ? 'event_fired_dryrun' : 'event_fired',
    details: { title: eventRow.title },
  });

  return { ok: true, code: eventRow.code, title: eventRow.title };
}

function registerRecurringEventCron(eventRow) {
  const existing = recurringCronJobs.get(eventRow.code);
  if (existing) {
    existing.stop();
    recurringCronJobs.delete(eventRow.code);
  }

  if (!eventRow.active || !eventRow.is_recurring || !eventRow.cron_expr) {
    return;
  }
  if (!cron.validate(eventRow.cron_expr)) {
    logger.warn('EVENT', `Ekspresi cron tidak valid untuk ${eventRow.code}: ${eventRow.cron_expr}`);
    return;
  }

  const job = cron.schedule(
    eventRow.cron_expr,
    () => {
      const latest = getDb().get(
        'SELECT * FROM events WHERE code = ? AND active = 1',
        [eventRow.code]
      );
      if (latest) {
        fireScheduledEvent(latest).catch((err) =>
          logger.error('EVENT', `Gagal menjalankan event terjadwal ${eventRow.code}`, err)
        );
      }
    },
    { timezone: config.timezone || 'Asia/Jakarta' }
  );

  recurringCronJobs.set(eventRow.code, job);
}

function reloadAllEventSchedules() {
  for (const job of recurringCronJobs.values()) {
    job.stop();
  }
  recurringCronJobs.clear();

  const rows = getDb().all('SELECT * FROM events WHERE active = 1 AND is_recurring = 1');
  for (const r of rows) {
    registerRecurringEventCron(r);
  }
}

async function sweepDueOneTimeEvents() {
  const now = Date.now();
  const dueRows = getDb().all(
    'SELECT * FROM events WHERE active = 1 AND is_recurring = 0 AND run_at IS NOT NULL AND run_at <= ?',
    [now]
  );
  for (const row of dueRows) {
    await fireScheduledEvent(row);
  }
}

function createScheduledEvent({
  rawSchedule,
  title,
  description = '',
  targetGroups = [],
  platforms = ['wa', 'discord', 'minecraft'],
  actorJid = '',
}) {
  const parsed = parseEventScheduleInput(rawSchedule);
  if (!parsed.valid) {
    return { ok: false, reason: parsed.reason };
  }

  const cleanTitle = String(title || '').trim().slice(0, 100);
  if (!cleanTitle) {
    return { ok: false, reason: 'Judul event wajib diisi' };
  }

  const code = `EV-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const now = Date.now();

  getDb().run(
    `INSERT INTO events (
       code, title, description, cron_expr, run_at, is_recurring, platforms_json, target_groups_json, active, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      code,
      cleanTitle,
      String(description || '').trim().slice(0, 260),
      parsed.cronExpr,
      parsed.runAt,
      parsed.isRecurring ? 1 : 0,
      JSON.stringify(platforms),
      JSON.stringify(targetGroups),
      now,
    ]
  );

  const inserted = getDb().get('SELECT * FROM events WHERE code = ?', [code]);
  if (parsed.isRecurring) {
    registerRecurringEventCron(inserted);
  }

  addAuditLog({
    category: 'event',
    actorJid: actorJid || 'owner',
    target: code,
    action: 'created',
    details: { title: cleanTitle, schedule: parsed.humanLabel },
  });

  return {
    ok: true,
    code,
    title: cleanTitle,
    scheduleLabel: parsed.humanLabel,
    isRecurring: parsed.isRecurring,
  };
}

function resolveScheduledEventByRef(codeOrIndexInput) {
  const cleaned = String(codeOrIndexInput || '')
    .replace(/^#+/, '')
    .trim()
    .toUpperCase();
  if (!cleaned) return null;

  if (/^\d{1,3}$/.test(cleaned)) {
    const activeList = listScheduledEvents(true);
    const idx = Number(cleaned) - 1;
    if (idx >= 0 && idx < activeList.length) {
      return activeList[idx];
    }
  }

  const withPrefix = cleaned.startsWith('EV-') ? cleaned : `EV-${cleaned}`;
  return (
    getDb().get(
      'SELECT * FROM events WHERE UPPER(code) = ? OR UPPER(code) = ?',
      [cleaned, withPrefix]
    ) || null
  );
}

function deleteScheduledEvent(codeInput) {
  const row = resolveScheduledEventByRef(codeInput);
  if (!row) return { ok: false };

  const job = recurringCronJobs.get(row.code);
  if (job) {
    job.stop();
    recurringCronJobs.delete(row.code);
  }
  getDb().run('DELETE FROM events WHERE id = ?', [row.id]);
  return { ok: true, code: row.code, title: row.title };
}

function listScheduledEvents(onlyActive = true) {
  if (onlyActive) {
    return getDb().all('SELECT * FROM events WHERE active = 1 ORDER BY id DESC');
  }
  return getDb().all('SELECT * FROM events ORDER BY id DESC LIMIT 20');
}

// =====================================================================
// 3. SISTEM TIKET / LAPORAN USER (.lapor & .tiket) SINKRON DISCORD 2 ARAH
// =====================================================================

const VALID_TICKET_CATEGORIES = ['bug', 'grief', 'cheater', 'topup', 'saran', 'umum'];

async function createSupportTicket({
  senderRawJid,
  pushName,
  categoryInput = 'umum',
  subjectInput = '',
  messageInput = '',
}) {
  const jid = normalizeUserJid(senderRawJid);
  ensureUser(jid, pushName);
  const db = getDb();

  const openCountRow = db.get(
    "SELECT COUNT(*) AS cnt FROM tickets WHERE jid = ? AND status = 'open'",
    [jid]
  );
  if (Number(openCountRow?.cnt || 0) >= 3) {
    return { ok: false, reason: 'too_many_open' };
  }

  const cleanMsg = String(messageInput || '').trim().slice(0, 700);
  if (cleanMsg.length < 5) {
    return { ok: false, reason: 'too_short' };
  }

  const catLower = String(categoryInput || 'umum').toLowerCase().trim();
  const category = VALID_TICKET_CATEGORIES.includes(catLower) ? catLower : 'umum';
  const subject =
    String(subjectInput || '').trim().slice(0, 100) ||
    cleanMsg.split(/\n/)[0].slice(0, 70);

  const ticketNo = `TKT-${crypto.randomInt(1000, 9999)}${crypto
    .randomBytes(1)
    .toString('hex')
    .toUpperCase()}`;
  const now = Date.now();
  const mcLink = getVerifiedLinkByJid(jid);

  const dcSync = await sendDiscordTicketAlert({
    ticketNo,
    userName: pushName || 'Member WA',
    userPhone: extractPhoneFromJid(jid),
    mcUsername: mcLink ? `${mcLink.mc_username}${mcLink.is_bedrock ? ' [BE]' : ''}` : 'Belum ditautkan',
    category,
    subject,
    message: cleanMsg,
  });

  db.run(
    `INSERT INTO tickets (
       ticket_no, jid, user_name, category, subject, message, status,
       discord_channel_id, discord_message_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [
      ticketNo,
      jid,
      pushName || 'Member WA',
      category,
      subject,
      cleanMsg,
      dcSync.channelId || null,
      dcSync.messageId || null,
      now,
      now,
    ]
  );

  addAuditLog({
    category: 'ticket',
    actorJid: jid,
    target: ticketNo,
    action: 'opened',
    details: { category, syncedDiscord: Boolean(dcSync.ok) },
  });

  return {
    ok: true,
    ticketNo,
    category,
    subject,
    syncedDiscord: Boolean(dcSync.ok),
    via: dcSync.via || 'Lokal DB',
  };
}

function isSameTicketOwner(ticketJid, actorRawJid) {
  const normTicket = normalizeUserJid(ticketJid);
  const normActor = normalizeUserJid(actorRawJid);
  if (normTicket && normActor && normTicket === normActor) return true;
  const p1 = extractPhoneFromJid(normTicket);
  const p2 = extractPhoneFromJid(normActor);
  return Boolean(p1 && p2 && p1 === p2);
}

function resolveSupportTicketRow(ticketNoInput, actorJid, isStaff = false) {
  const db = getDb();
  const cleaned = String(ticketNoInput || '')
    .replace(/^#+/, '')
    .trim()
    .toUpperCase();

  if (!cleaned) return null;

  // 1. Mendukung nomor urut 1, 2, 3 sesuai daftar .tiket / .tiket admin
  if (/^\d{1,2}$/.test(cleaned)) {
    const list = listTicketsForUser(actorJid, { includeAllForAdmin: isStaff });
    const idx = Number(cleaned) - 1;
    if (idx >= 0 && idx < list.length) {
      return list[idx];
    }
  }

  // 2. Mendukung TKT-XXXX, #TKT-XXXX, maupun kode pendek XXXX tanpa prefix TKT-
  const withPrefix = cleaned.startsWith('TKT-') ? cleaned : `TKT-${cleaned}`;
  return (
    db.get(
      'SELECT * FROM tickets WHERE UPPER(ticket_no) = ? OR UPPER(ticket_no) = ?',
      [cleaned, withPrefix]
    ) || null
  );
}

/**
 * Balasan lanjutan dari WhatsApp (oleh Pelapor sendiri atau Admin/Owner WA)
 */
async function replySupportTicket({
  actorRawJid,
  actorName,
  isStaff = false,
  ticketNoInput,
  replyText,
}) {
  const actorJid = normalizeUserJid(actorRawJid);
  const cleanReply = String(replyText || '').trim().slice(0, 600);
  if (!cleanReply) return { ok: false, reason: 'empty' };

  const db = getDb();
  const row = resolveSupportTicketRow(ticketNoInput, actorJid, isStaff);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'open') return { ok: false, reason: 'closed' };
  if (!isStaff && !isSameTicketOwner(row.jid, actorJid)) {
    return { ok: false, reason: 'forbidden' };
  }

  const canonicalOwnerJid = normalizeUserJid(row.jid) || row.jid;

  db.run(
    'UPDATE tickets SET jid = ?, assigned_to = COALESCE(assigned_to, ?), updated_at = ? WHERE id = ?',
    [canonicalOwnerJid, isStaff ? actorName || 'Admin WA' : row.assigned_to, Date.now(), row.id]
  );

  // Sinkronkan ke thread Discord
  await sendDiscordTicketFollowUp({
    channelId: row.discord_channel_id,
    ticketNo: row.ticket_no,
    senderLabel: isStaff ? `Admin ${actorName}` : `Pelapor ${actorName}`,
    text: cleanReply,
    isClosure: false,
  });

  // Bila yang membalas adalah Admin/Owner WA, teruskan langsung ke chat WA pelapor!
  if (isStaff && !isSameTicketOwner(canonicalOwnerJid, actorJid) && activeWaSock && !config.dryRun) {
    try {
      await activeWaSock.sendMessage(canonicalOwnerJid, {
        text: renderBox(
          `💬 ʙᴀʟᴀsᴀɴ ᴛɪᴋᴇᴛ #${keep(row.ticket_no)}`,
          [
            `✦ Dari Admin : ${keep(actorName || 'Tim CipiSMP')}`,
            `✦ Pesan      : ${keep(cleanReply)}`,
            '',
            `◦ Balas kembali dengan ${mono(`${config.prefix}tiket balas ${row.ticket_no} <pesan>`)} ♡`,
          ],
          { footer: config.footer }
        ),
      });
    } catch (err) {
      logger.warn('TICKET', `Gagal meneruskan balasan admin ke WA pelapor: ${err.message}`);
    }
  }

  return { ok: true, ticketNo: row.ticket_no, ownerJid: canonicalOwnerJid };
}

/**
 * Tutup tiket beserta catatan solusi & beri tahu pelapor di WA + thread Discord
 */
async function closeSupportTicket({
  actorRawJid,
  actorName,
  isStaff = false,
  ticketNoInput,
  resolutionText = 'Laporan telah ditangani. Terima kasih atas masukannya!',
}) {
  const actorJid = normalizeUserJid(actorRawJid);
  const db = getDb();
  const row = resolveSupportTicketRow(ticketNoInput, actorJid, isStaff);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status === 'closed') return { ok: false, reason: 'already_closed' };
  if (!isStaff && !isSameTicketOwner(row.jid, actorJid)) {
    return { ok: false, reason: 'forbidden' };
  }

  const canonicalOwnerJid = normalizeUserJid(row.jid) || row.jid;
  const now = Date.now();
  const cleanRes = String(resolutionText || 'Selesai').trim().slice(0, 400);

  db.run(
    `UPDATE tickets
     SET jid = ?,
         status = 'closed',
         assigned_to = COALESCE(assigned_to, ?),
         resolution = ?,
         updated_at = ?,
         closed_at = ?
     WHERE id = ?`,
    [canonicalOwnerJid, actorName || 'Admin', cleanRes, now, now, row.id]
  );

  await sendDiscordTicketFollowUp({
    channelId: row.discord_channel_id,
    ticketNo: row.ticket_no,
    senderLabel: actorName || 'Admin',
    text: cleanRes,
    isClosure: true,
  });

  if (activeWaSock && !config.dryRun && !isSameTicketOwner(canonicalOwnerJid, actorJid)) {
    try {
      await activeWaSock.sendMessage(canonicalOwnerJid, {
        text: formatSuccess(`Tiket #${keep(row.ticket_no)} Selesai`, [
          `✦ Ditutup Oleh : ${keep(actorName || 'Admin CipiSMP')}`,
          `✦ Catatan/Solusi: ${keep(cleanRes)}`,
          '◦ Terima kasih sudah ikut menjaga kenyamanan CipiSMP ya ♡',
        ]),
      });
    } catch (err) {
      logger.warn('TICKET', `Gagal kirim notifikasi tutup tiket ke ${canonicalOwnerJid}: ${err.message}`);
    }
  }

  return { ok: true, ticketNo: row.ticket_no, resolution: cleanRes };
}

/**
 * Handler pesan masuk dari Channel/Thread Admin Discord -> diteruskan ke WA Pelapor!
 * Mendukung:
 * 1) `!balas TKT-XXXX <pesan>` atau `!tutup TKT-XXXX <solusi>` di channel tiket
 * 2) Chat biasa oleh Admin langsung di dalam Thread khusus tiket tersebut!
 */
async function handleDiscordTicketIncoming({
  authorName,
  content,
  channelId,
  isThread,
  referenceMessageId,
}) {
  const db = getDb();
  const text = String(content || '').trim();
  if (!text) return { handled: false };

  // 1. Cek command eksplisit !tutup TKT-XXXX <solusi>
  const closeMatch = /^[!.](?:tutup|close)\s+(TKT-[A-Z0-9]+)(?:\s+([\s\S]+))?$/i.exec(text);
  if (closeMatch) {
    const tNo = closeMatch[1].toUpperCase();
    const reason = (closeMatch[2] || 'Telah diselesaikan oleh Admin Discord').trim();
    const res = await closeSupportTicket({
      actorRawJid: 'discord_admin',
      actorName: `${authorName} (Discord)`,
      isStaff: true,
      ticketNoInput: tNo,
      resolutionText: reason,
    });
    return { handled: res.ok, action: 'closed', ticketNo: tNo };
  }

  // 2. Cek command eksplisit !balas TKT-XXXX <pesan>
  const replyMatch = /^[!.](?:balas|reply)\s+(TKT-[A-Z0-9]+)\s+([\s\S]+)$/i.exec(text);
  if (replyMatch) {
    const tNo = replyMatch[1].toUpperCase();
    const replyBody = replyMatch[2].trim();
    const row = db.get("SELECT * FROM tickets WHERE UPPER(ticket_no) = ? AND status = 'open'", [
      tNo,
    ]);
    if (!row) return { handled: false, reason: 'ticket_not_open' };

    db.run('UPDATE tickets SET assigned_to = ?, updated_at = ? WHERE id = ?', [
      `${authorName} (Discord)`,
      Date.now(),
      row.id,
    ]);

    if (activeWaSock && !config.dryRun) {
      await activeWaSock.sendMessage(row.jid, {
        text: renderBox(
          `💬 ʙᴀʟᴀsᴀɴ ᴀᴅᴍɪɴ ᴅɪsᴄᴏʀᴅ • #${keep(row.ticket_no)}`,
          [
            `✦ Admin : ${keep(authorName)}`,
            `✦ Pesan : ${keep(replyBody)}`,
            '',
            `◦ Balas dari WA dengan ${mono(`${config.prefix}tiket balas ${row.ticket_no} <pesan>`)} ♡`,
          ],
          { footer: config.footer }
        ),
      });
    }
    return { handled: true, action: 'replied', ticketNo: row.ticket_no };
  }

  // 3. Jika Admin langsung mengetik di dalam Thread khusus tiket (tanpa perlu ketik kode!)
  if (text.startsWith('!') || text.startsWith('.')) return { handled: false };

  let linkedTicket = null;
  if (isThread && channelId) {
    linkedTicket = db.get(
      "SELECT * FROM tickets WHERE discord_channel_id = ? AND status = 'open' LIMIT 1",
      [channelId]
    );
  } else if (referenceMessageId) {
    linkedTicket = db.get(
      "SELECT * FROM tickets WHERE discord_message_id = ? AND status = 'open' LIMIT 1",
      [referenceMessageId]
    );
  }

  if (!linkedTicket) return { handled: false };

  db.run('UPDATE tickets SET assigned_to = ?, updated_at = ? WHERE id = ?', [
    `${authorName} (Discord)`,
    Date.now(),
    linkedTicket.id,
  ]);

  if (activeWaSock && !config.dryRun) {
    await activeWaSock
      .sendMessage(linkedTicket.jid, {
        text: renderBox(
          `💬 ʙᴀʟᴀsᴀɴ ᴀᴅᴍɪɴ ᴅɪsᴄᴏʀᴅ • #${keep(linkedTicket.ticket_no)}`,
          [
            `✦ Admin : ${keep(authorName)}`,
            `✦ Pesan : ${keep(text)}`,
            '',
            `◦ Balas dari WA dengan ${mono(`${config.prefix}tiket balas ${linkedTicket.ticket_no} <pesan>`)} ♡`,
          ],
          { footer: config.footer }
        ),
      })
      .catch((err) =>
        logger.warn('TICKET', `Gagal kirim balasan thread Discord ke WA: ${err.message}`)
      );
  }

  return { handled: true, action: 'replied_thread', ticketNo: linkedTicket.ticket_no };
}

function listTicketsForUser(rawJid, { includeAllForAdmin = false } = {}) {
  const db = getDb();
  if (includeAllForAdmin) {
    return db.all(
      "SELECT * FROM tickets WHERE status = 'open' ORDER BY created_at DESC LIMIT 15"
    );
  }
  const jid = normalizeUserJid(rawJid);
  return db.all(
    'SELECT * FROM tickets WHERE jid = ? ORDER BY created_at DESC LIMIT 10',
    [jid]
  );
}

// =====================================================================
// 4. QUEST HARIAN (3 MISI ACAK PER USER, RESET TENGAH MALAM WIB)
// =====================================================================

const DAILY_QUEST_POOL = Object.freeze([
  {
    code: 'chat_aktif',
    title: 'Sapa Warga Komunitas (8x Chat)',
    target: 8,
    rewardCoins: 200,
    rewardXp: 45,
  },
  {
    code: 'klaim_daily',
    title: 'Absen Harian Sakura (.daily)',
    target: 1,
    rewardCoins: 150,
    rewardXp: 35,
  },
  {
    code: 'kerja_rajin',
    title: 'Bekerja Mencari Koin 2x (.kerja)',
    target: 2,
    rewardCoins: 280,
    rewardXp: 65,
  },
  {
    code: 'pantau_server',
    title: 'Pantau Status Server (.server)',
    target: 1,
    rewardCoins: 160,
    rewardXp: 40,
  },
  {
    code: 'berbagi_koin',
    title: 'Berbagi Koin ke Sahabat (.transfer)',
    target: 1,
    rewardCoins: 220,
    rewardXp: 55,
  },
  {
    code: 'kreator_stiker',
    title: 'Buat Stiker Kawaii (.sticker)',
    target: 1,
    rewardCoins: 200,
    rewardXp: 50,
  },
  {
    code: 'galeri_anime',
    title: 'Jelajahi Galeri Anime 2x (.anime)',
    target: 2,
    rewardCoins: 180,
    rewardXp: 45,
  },
  {
    code: 'tanya_ai',
    title: 'Bertanya ke Asisten Cipi (.ai)',
    target: 1,
    rewardCoins: 190,
    rewardXp: 45,
  },
]);

const COMMAND_TO_QUEST_CODE = Object.freeze({
  daily: 'klaim_daily',
  kerja: 'kerja_rajin',
  server: 'pantau_server',
  transfer: 'berbagi_koin',
  sticker: 'kreator_stiker',
  anime: 'galeri_anime',
  ai: 'tanya_ai',
});

/**
 * Pastikan user memiliki 3 quest harian acak untuk tanggal WIB hari ini
 */
function ensureUserDailyQuests(rawJid) {
  const jid = normalizeUserJid(rawJid);
  if (!jid) return [];
  ensureUser(jid);

  const db = getDb();
  const today = getWibDateKey();

  return db.transaction(() => {
    const existing = db.all(
      'SELECT * FROM quests WHERE jid = ? AND quest_date = ? ORDER BY id ASC',
      [jid, today]
    );
    if (existing.length >= 3) {
      return existing;
    }

    const picked = pickRandomUnique(DAILY_QUEST_POOL, 3);
    const now = Date.now();
    for (const q of picked) {
      db.run(
        `INSERT OR IGNORE INTO quests (
           jid, quest_date, quest_code, quest_title, target_count, current_count,
           reward_balance, reward_xp, claimed, created_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`,
        [jid, today, q.code, q.title, q.target, q.rewardCoins, q.rewardXp, now]
      );
    }

    return db.all(
      'SELECT * FROM quests WHERE jid = ? AND quest_date = ? ORDER BY id ASC',
      [jid, today]
    );
  });
}

/**
 * Tambah progres misi harian user bila misi tersebut terpilih hari ini
 */
function recordQuestProgress(rawJid, questCode, step = 1) {
  const jid = normalizeUserJid(rawJid);
  if (!jid || !questCode) return null;

  const quests = ensureUserDailyQuests(jid);
  const match = quests.find((q) => q.quest_code === questCode);
  if (!match || match.claimed) return null;
  if (Number(match.current_count) >= Number(match.target_count)) return null;

  const nextVal = Math.min(
    Number(match.target_count),
    Number(match.current_count) + Math.max(1, step)
  );

  getDb().run('UPDATE quests SET current_count = ? WHERE id = ?', [
    nextVal,
    match.id,
  ]);

  return {
    justCompleted: nextVal >= Number(match.target_count),
    questTitle: match.quest_title,
    rewardCoins: Number(match.reward_balance),
    rewardXp: Number(match.reward_xp),
  };
}

/**
 * Klaim seluruh hadiah Quest Harian yang sudah mencapai target hari ini (+ bonus sapu bersih 3/3!)
 */
function claimDailyQuestRewards(rawJid) {
  const jid = normalizeUserJid(rawJid);
  const db = getDb();
  const today = getWibDateKey();
  ensureUserDailyQuests(jid);

  const claimData = db.transaction(() => {
    const rows = db.all(
      'SELECT * FROM quests WHERE jid = ? AND quest_date = ? ORDER BY id ASC',
      [jid, today]
    );

    const claimable = rows.filter(
      (r) => Number(r.current_count) >= Number(r.target_count) && Number(r.claimed) === 0
    );

    if (claimable.length === 0) {
      return { ok: false, rows };
    }

    let totalCoins = 0;
    let totalXp = 0;
    const claimedTitles = [];

    for (const q of claimable) {
      db.run('UPDATE quests SET claimed = 1 WHERE id = ?', [q.id]);
      totalCoins += Number(q.reward_balance || 0);
      totalXp += Number(q.reward_xp || 0);
      claimedTitles.push(q.quest_title);
    }

    const updatedRows = db.all(
      'SELECT * FROM quests WHERE jid = ? AND quest_date = ?',
      [jid, today]
    );
    const allThreeClaimed =
      updatedRows.length === 3 && updatedRows.every((r) => Number(r.claimed) === 1);
    const previouslyAllClaimed =
      rows.length === 3 && rows.every((r) => Number(r.claimed) === 1);

    let fullClearBonusCoins = 0;
    let fullClearBonusXp = 0;
    if (allThreeClaimed && !previouslyAllClaimed) {
      fullClearBonusCoins = 300;
      fullClearBonusXp = 80;
      totalCoins += fullClearBonusCoins;
      totalXp += fullClearBonusXp;
    }

    return {
      ok: true,
      claimedTitles,
      totalCoins,
      totalXp,
      fullClearBonusCoins,
      fullClearBonusXp,
    };
  });

  if (!claimData.ok) {
    return claimData;
  }

  const walletAfter = addBalance(jid, claimData.totalCoins);
  const xpRes = addXp(jid, claimData.totalXp);

  return {
    ...claimData,
    newBalance: Number(walletAfter || 0),
    xpResult: xpRes,
  };
}

function pruneOldQuestsHistory() {
  // Simpan quest yang sudah diklaim untuk statistik papan peringkat, hapus baris tidak diklaim > 14 hari
  const cutoffDate = getWibDateKey(new Date(Date.now() - 14 * 86400 * 1000));
  const res = getDb().run(
    'DELETE FROM quests WHERE quest_date < ? AND claimed = 0',
    [cutoffDate]
  );
  return res.changes;
}

// =====================================================================
// 5. PAPAN PERINGKAT SERVER (.topserver: Playtime Minecraft & Quest Rajin)
// =====================================================================

function getServerLeaderboardData(mode = 'playtime', callerRawJid = '', limit = 10) {
  const db = getDb();
  const callerJid = callerRawJid ? normalizeUserJid(callerRawJid) : '';

  if (mode === 'quest' || mode === 'misi') {
    const rows = db.all(
      `SELECT q.jid,
              COALESCE(u.name, 'Sahabat Cipi') AS name,
              COALESCE(u.level, 1) AS level,
              l.mc_username,
              l.is_bedrock,
              COUNT(q.id) AS completed_quests
       FROM quests q
       INNER JOIN users u ON u.jid = q.jid
       LEFT JOIN links l ON l.jid = q.jid AND l.status = 'verified'
       WHERE q.claimed = 1 AND u.is_banned = 0
       GROUP BY q.jid
       ORDER BY completed_quests DESC, u.level DESC
       LIMIT ?`,
      [limit]
    );

    let callerRank = null;
    if (callerJid) {
      const myCntRow = db.get(
        'SELECT COUNT(*) AS cnt FROM quests WHERE jid = ? AND claimed = 1',
        [callerJid]
      );
      const myCnt = Number(myCntRow?.cnt || 0);
      if (myCnt > 0) {
        const higher = db.get(
          `SELECT COUNT(*) AS cnt FROM (
             SELECT jid FROM quests WHERE claimed = 1 GROUP BY jid HAVING COUNT(id) > ?
           )`,
          [myCnt]
        );
        callerRank = Number(higher?.cnt || 0) + 1;
      }
    }

    return {
      mode: 'quest',
      rows: rows.map((r) => ({
        jid: r.jid,
        name: r.mc_username || r.name,
        isBedrock: Boolean(r.is_bedrock),
        level: Number(r.level || 1),
        completedQuests: Number(r.completed_quests || 0),
      })),
      callerRank,
    };
  }

  // Default: Peringkat Jam Bermain Server Minecraft (playtime_minutes + akun tertaut)
  const rows = db.all(
    `SELECT u.jid,
            u.name,
            u.level,
            u.playtime_minutes,
            l.mc_username,
            l.is_bedrock
     FROM users u
     LEFT JOIN links l ON l.jid = u.jid AND l.status = 'verified'
     WHERE u.is_banned = 0 AND (u.playtime_minutes > 0 OR l.status = 'verified')
     ORDER BY u.playtime_minutes DESC, u.level DESC, u.created_at ASC
     LIMIT ?`,
    [limit]
  );

  let callerRank = null;
  if (callerJid) {
    const me = db.get('SELECT playtime_minutes FROM users WHERE jid = ?', [callerJid]);
    if (me && Number(me.playtime_minutes) > 0) {
      const higher = db.get(
        'SELECT COUNT(*) AS cnt FROM users WHERE is_banned = 0 AND playtime_minutes > ?',
        [me.playtime_minutes]
      );
      callerRank = Number(higher?.cnt || 0) + 1;
    }
  }

  return {
    mode: 'playtime',
    rows: rows.map((r) => ({
      jid: r.jid,
      name: r.mc_username || r.name || 'Petualang',
      waName: r.name || 'Sahabat Cipi',
      isBedrock: Boolean(r.is_bedrock),
      isLinked: Boolean(r.mc_username),
      level: Number(r.level || 1),
      playtimeMinutes: Number(r.playtime_minutes || 0),
    })),
    callerRank,
  };
}

// =====================================================================
// 6. LIFECYCLE & REGISTRASI OTOMATIS KE INDEX.JS
// =====================================================================

function startCommunitySchedulers() {
  reloadAllEventSchedules();
  sweepDueGiveaways().catch((err) =>
    logger.error('GIVEAWAY', 'Gagal memeriksa giveaway awal', err)
  );
  sweepDueOneTimeEvents().catch((err) =>
    logger.error('EVENT', 'Gagal memeriksa event awal', err)
  );

  if (!giveawaySweepTimer) {
    giveawaySweepTimer = setInterval(() => {
      sweepDueGiveaways().catch(() => {});
      sweepDueOneTimeEvents().catch(() => {});
    }, 15 * 1000);
    if (typeof giveawaySweepTimer.unref === 'function') giveawaySweepTimer.unref();
  }

  if (!midnightQuestTask) {
    midnightQuestTask = cron.schedule(
      '2 0 * * *',
      () => {
        try {
          pruneOldQuestsHistory();
          logger.info('QUEST', `Pergantian hari WIB (${getWibParts().dateKey}): Quest harian direset untuk semua member ♡`);
        } catch (err) {
          logger.error('QUEST', 'Gagal menjalankan pembersihan tengah malam quest', err);
        }
      },
      { timezone: config.timezone || 'Asia/Jakarta' }
    );
  }
}

function stopCommunitySchedulers() {
  if (giveawaySweepTimer) {
    clearInterval(giveawaySweepTimer);
    giveawaySweepTimer = null;
  }
  for (const t of giveawayTimers.values()) {
    clearTimeout(t);
  }
  giveawayTimers.clear();

  for (const job of recurringCronJobs.values()) {
    job.stop();
  }
  recurringCronJobs.clear();

  if (midnightQuestTask) {
    midnightQuestTask.stop();
    midnightQuestTask = null;
  }
}

function register({ registerHook }) {
  setDiscordBridgeListeners({
    onTicketMessage: handleDiscordTicketIncoming,
  });

  startCommunitySchedulers();

  registerHook('onSocketReady', async (sock) => {
    activeWaSock = sock;
    await sweepDueGiveaways();
    await sweepDueOneTimeEvents();
  });

  // Lacak otomatis misi "chat_aktif" saat user mengobrol biasa
  registerHook('onMessagePreCommand', async ({ senderJid, body, msg }) => {
    if (msg?.key?.fromMe || !senderJid) return;
    const text = String(body || '').trim();
    if (!text || text.startsWith(config.prefix || '.')) return;
    recordQuestProgress(senderJid, 'chat_aktif', 1);
  });

  // Lacak otomatis misi berbasis command saat command sukses dijalankan
  registerHook('onCommandSuccess', async ({ sock, chatJid, msg, senderJid, commandName }) => {
    const qCode = COMMAND_TO_QUEST_CODE[commandName];
    if (!qCode || !senderJid) return;

    const prog = recordQuestProgress(senderJid, qCode, 1);
    if (prog && prog.justCompleted && sock && !config.dryRun) {
      await sock
        .sendMessage(
          chatJid,
          {
            text: formatSuccess('Misi Harian Selesai!', [
              `✦ Misi   : ${keep(prog.questTitle)}`,
              `✦ Hadiah : +${formatNumber(prog.rewardCoins)} ${config.economy.currencyName} & +${prog.rewardXp} XP`,
              `◦ Klaim hadiahmu sekarang lewat ${mono(`${config.prefix}quest klaim`)} ♡`,
            ]),
          },
          { quoted: msg }
        )
        .catch(() => {});
    }
  });

  process.once('SIGINT', () => stopCommunitySchedulers());
  process.once('SIGTERM', () => stopCommunitySchedulers());

  logger.info('COMMUNITY', 'Penjadwal Giveaway, Event Cron WIB, Tiket 2 Arah Discord & Quest Harian aktif');
}

module.exports = {
  DAILY_QUEST_POOL,
  VALID_TICKET_CATEGORIES,
  parseDurationMs,
  parseEventScheduleInput,
  createGiveaway,
  joinGiveaway,
  finishGiveaway,
  rerollGiveaway,
  cancelGiveaway,
  listActiveGiveaways,
  sweepDueGiveaways,
  createScheduledEvent,
  resolveScheduledEventByRef,
  deleteScheduledEvent,
  listScheduledEvents,
  fireScheduledEvent,
  sweepDueOneTimeEvents,
  reloadAllEventSchedules,
  createSupportTicket,
  replySupportTicket,
  closeSupportTicket,
  handleDiscordTicketIncoming,
  listTicketsForUser,
  ensureUserDailyQuests,
  recordQuestProgress,
  claimDailyQuestRewards,
  getServerLeaderboardData,
  startCommunitySchedulers,
  stopCommunitySchedulers,
  register,
};
