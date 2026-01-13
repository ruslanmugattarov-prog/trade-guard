import express from "express";
import cors from "cors";
import { openDb } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const db = openDb(process.env.SQLITE_PATH || "./tradeguard.sqlite");

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function computeDayKey(tsSec, tzOffsetMin) {
  const ms = (tsSec * 1000) + (tzOffsetMin * 60 * 1000);
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfNextDayTs(tsSec, tzOffsetMin) {
  const localMs = (tsSec * 1000) + (tzOffsetMin * 60 * 1000);
  const d = new Date(localMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  const nextLocalMs = d.getTime();
  const utcMs = nextLocalMs - (tzOffsetMin * 60 * 1000);
  return Math.floor(utcMs / 1000);
}

function ensureUser(tgUserId) {
  const ts = nowTs();

  db.prepare(`
    INSERT INTO users (tg_user_id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(tg_user_id) DO UPDATE SET updated_at=excluded.updated_at
  `).run(String(tgUserId), ts, ts);

  db.prepare(`
    INSERT INTO settings (tg_user_id, max_trades_per_day, max_losses_per_day, max_loss_streak, timezone_offset_min, updated_at)
    VALUES (?, 6, 3, 2, 60, ?)
    ON CONFLICT(tg_user_id) DO NOTHING
  `).run(String(tgUserId), ts);

  db.prepare(`
    INSERT INTO state (tg_user_id, day_key, trades_today, losses_today, loss_streak, trading_off_until_ts, off_reason, updated_at)
    VALUES (?, '', 0, 0, 0, 0, '', ?)
    ON CONFLICT(tg_user_id) DO NOTHING
  `).run(String(tgUserId), ts);
}

function getSettings(tgUserId) {
  return db.prepare(`SELECT * FROM settings WHERE tg_user_id=?`).get(String(tgUserId));
}

function getState(tgUserId) {
  return db.prepare(`SELECT * FROM state WHERE tg_user_id=?`).get(String(tgUserId));
}

function setState(tgUserId, patch) {
  const ts = nowTs();
  const curr = getState(tgUserId);
  const next = { ...curr, ...patch, updated_at: ts };

  db.prepare(`
    UPDATE state
    SET day_key=?,
        trades_today=?,
        losses_today=?,
        loss_streak=?,
        trading_off_until_ts=?,
        off_reason=?,
        updated_at=?
    WHERE tg_user_id=?
  `).run(
    next.day_key,
    next.trades_today,
    next.losses_today,
    next.loss_streak,
    next.trading_off_until_ts,
    next.off_reason,
    next.updated_at,
    String(tgUserId)
  );

  return next;
}

function logEvent(tgUserId, type, detail) {
  db.prepare(`INSERT INTO events (tg_user_id, ts, type, detail) VALUES (?, ?, ?, ?)`)
    .run(String(tgUserId), nowTs(), type, detail);
}

function syncDayAndStops(tgUserId) {
  const s = getSettings(tgUserId);
  const st = getState(tgUserId);
  const ts = nowTs();

  const todayKey = computeDayKey(ts, s.timezone_offset_min);
  let patch = {};

  if (st.day_key !== todayKey) {
    patch.day_key = todayKey;
    patch.trades_today = 0;
    patch.losses_today = 0;
    patch.loss_streak = 0;

    if (st.trading_off_until_ts <= ts) {
      patch.trading_off_until_ts = 0;
      patch.off_reason = "";
    }

    logEvent(tgUserId, "DAY_RESET", `Reset to ${todayKey}`);
  } else {
    if (st.trading_off_until_ts > 0 && st.trading_off_until_ts <= ts) {
      patch.trading_off_until_ts = 0;
      patch.off_reason = "";
      logEvent(tgUserId, "STOP_EXPIRED", "Stop expired, trading enabled");
    }
  }

  if (Object.keys(patch).length) return setState(tgUserId, patch);
  return st;
}

function isTradingOff(st) {
  const ts = nowTs();
  return st.trading_off_until_ts > ts;
}

function enforceLimits(tgUserId) {
  const s = getSettings(tgUserId);
  let st = getState(tgUserId);
  const ts = nowTs();

  if (isTradingOff(st)) return st;

  let reason = "";
  if (st.trades_today >= s.max_trades_per_day) reason = "Max trades per day reached";
  else if (st.losses_today >= s.max_losses_per_day) reason = "Max losses per day reached";
  else if (st.loss_streak >= s.max_loss_streak) reason = "Max loss streak reached";

  if (reason) {
    const offUntil = startOfNextDayTs(ts, s.timezone_offset_min);
    st = setState(tgUserId, { trading_off_until_ts: offUntil, off_reason: reason });
    logEvent(tgUserId, "STOP_DAY", `${reason}; off until ${offUntil}`);
    return st;
  }
  return st;
}

// --- routes ---
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/api/bootstrap", (req, res) => {
  const { tgUserId } = req.body || {};
  if (!tgUserId) return res.status(400).json({ error: "tgUserId required" });

  ensureUser(tgUserId);
  syncDayAndStops(tgUserId);
  enforceLimits(tgUserId);

  res.json({ settings: getSettings(tgUserId), state: getState(tgUserId) });
});

app.post("/api/settings", (req, res) => {
  const { tgUserId, maxTradesPerDay, maxLossesPerDay, maxLossStreak, timezoneOffsetMin } = req.body || {};
  if (!tgUserId) return res.status(400).json({ error: "tgUserId required" });

  ensureUser(tgUserId);

  const mtd = Math.max(1, Math.min(50, Number(maxTradesPerDay ?? 6)));
  const mld = Math.max(0, Math.min(50, Number(maxLossesPerDay ?? 3)));
  const mls = Math.max(1, Math.min(50, Number(maxLossStreak ?? 2)));
  const tz = Math.max(-720, Math.min(840, Number(timezoneOffsetMin ?? 60)));

  db.prepare(`
    UPDATE settings
    SET max_trades_per_day=?,
        max_losses_per_day=?,
        max_loss_streak=?,
        timezone_offset_min=?,
        updated_at=?
    WHERE tg_user_id=?
  `).run(mtd, mld, mls, tz, nowTs(), String(tgUserId));

  logEvent(tgUserId, "SETTINGS_UPDATE", `mtd=${mtd}, mld=${mld}, mls=${mls}, tz=${tz}`);

  syncDayAndStops(tgUserId);
  enforceLimits(tgUserId);

  res.json({ settings: getSettings(tgUserId), state: getState(tgUserId) });
});

app.post("/api/record", (req, res) => {
  const { tgUserId, outcome } = req.body || {};
  if (!tgUserId) return res.status(400).json({ error: "tgUserId required" });
  if (!["WIN", "LOSS"].includes(outcome)) return res.status(400).json({ error: "outcome must be WIN or LOSS" });

  ensureUser(tgUserId);
  syncDayAndStops(tgUserId);

  let st = getState(tgUserId);

  if (isTradingOff(st)) {
    return res.status(403).json({ error: "TRADING_OFF", state: st });
  }

  const patch = { trades_today: st.trades_today + 1 };
  if (outcome === "LOSS") {
    patch.losses_today = st.losses_today + 1;
    patch.loss_streak = st.loss_streak + 1;
  } else {
    patch.loss_streak = 0;
  }

  st = setState(tgUserId, patch);
  logEvent(tgUserId, "RECORD", outcome);

  st = enforceLimits(tgUserId);

  res.json({ settings: getSettings(tgUserId), state: st });
});

app.get("/api/events", (req, res) => {
  const tgUserId = req.query.tgUserId;
  if (!tgUserId) return res.status(400).json({ error: "tgUserId required" });

  ensureUser(tgUserId);

  const rows = db.prepare(`
    SELECT ts, type, detail
    FROM events
    WHERE tg_user_id=?
    ORDER BY ts DESC
    LIMIT 50
  `).all(String(tgUserId));

  res.json({ events: rows });
});

// --- start server ---
const PORT = 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Trade Guard server is running on http://localhost:${PORT}`);
});

