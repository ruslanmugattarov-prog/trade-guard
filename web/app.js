const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const API_BASE = "http://localhost:8080";

function getTgUserId() {
  const id = tg?.initDataUnsafe?.user?.id;
  if (id) return String(id);

  // Локальный тест (в обычном браузере)
  const local = localStorage.getItem("tg_user_id");
  if (local) return local;
  const fake = String(Math.floor(100000000 + Math.random() * 900000000));
  localStorage.setItem("tg_user_id", fake);
  return fake;
}

const tgUserId = getTgUserId();

const el = (id) => document.getElementById(id);
const statusText = el("statusText");
const statusReason = el("statusReason");
const tradesToday = el("tradesToday");
const lossesToday = el("lossesToday");
const lossStreak = el("lossStreak");

const maxTradesPerDay = el("maxTradesPerDay");
const maxLossesPerDay = el("maxLossesPerDay");
const maxLossStreak = el("maxLossStreak");
const timezoneOffsetMin = el("timezoneOffsetMin");
const saveHint = el("saveHint");

const eventsCard = el("eventsCard");
const eventsList = el("eventsList");

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || "Request failed");
    err.data = data;
    throw err;
  }
  return data;
}

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

function render({ settings, state }) {
  const now = Math.floor(Date.now() / 1000);
  const off = state.trading_off_until_ts > now;

  statusText.textContent = off ? "TRADING OFF" : "TRADING ON";
  statusText.className = off ? "status-off" : "status-on";

  if (off) {
    const dt = new Date(state.trading_off_until_ts * 1000);
    statusReason.textContent = `${state.off_reason} • до ${dt.toLocaleString()}`;
  } else {
    statusReason.textContent = "Торговля разрешена по твоим правилам.";
  }

  tradesToday.textContent = state.trades_today;
  lossesToday.textContent = state.losses_today;
  lossStreak.textContent = state.loss_streak;

  maxTradesPerDay.value = settings.max_trades_per_day;
  maxLossesPerDay.value = settings.max_losses_per_day;
  maxLossStreak.value = settings.max_loss_streak;
  timezoneOffsetMin.value = settings.timezone_offset_min;

  el("btnWin").disabled = off;
  el("btnLoss").disabled = off;
}

async function bootstrap() {
  saveHint.textContent = "";
  const data = await post("/api/bootstrap", { tgUserId });
  render(data);
}

async function record(outcome) {
  saveHint.textContent = "";
  try {
    const data = await post("/api/record", { tgUserId, outcome });
    render(data);
  } catch (e) {
    if (e.data?.error === "TRADING_OFF") {
      alert("TRADING OFF: сегодня торговать нельзя.");
      return;
    }
    alert(e.message);
  }
}

async function saveSettings() {
  saveHint.textContent = "Сохраняю…";
  const body = {
    tgUserId,
    maxTradesPerDay: Number(maxTradesPerDay.value),
    maxLossesPerDay: Number(maxLossesPerDay.value),
    maxLossStreak: Number(maxLossStreak.value),
    timezoneOffsetMin: Number(timezoneOffsetMin.value)
  };
  const data = await post("/api/settings", body);
  render(data);
  saveHint.textContent = "Сохранено. Trade Guard будет следовать этим лимитам.";
}

async function toggleEvents() {
  if (eventsCard.style.display === "none") {
    const data = await get(`/api/events?tgUserId=${encodeURIComponent(tgUserId)}`);
    eventsList.innerHTML = data.events.map(ev => {
      const dt = new Date(ev.ts * 1000).toLocaleString();
      return `<div style="margin:8px 0;"><b>${ev.type}</b> — ${dt}<br/><span class="muted">${ev.detail}</span></div>`;
    }).join("") || "Пока событий нет.";
    eventsCard.style.display = "block";
  } else {
    eventsCard.style.display = "none";
  }
}

el("btnWin").addEventListener("click", () => record("WIN"));
el("btnLoss").addEventListener("click", () => record("LOSS"));
el("btnRefresh").addEventListener("click", () => bootstrap());
el("btnSave").addEventListener("click", () => saveSettings());
el("btnEvents").addEventListener("click", () => toggleEvents());

bootstrap();

