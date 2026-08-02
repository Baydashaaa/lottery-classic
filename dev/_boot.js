/* ===== Предпоказ страницы Oracle Draw ===================================== */


const TIERS = ["common", "rare", "legendary"];
function wallet(i, entries, id, tier) {
  return ["terra1" + Math.random().toString(36).slice(2, 12) + i, entries, id, tier];
}

const DAILY_ROWS = [
  wallet(1, 12, 142, "common"),    wallet(2, 5, 141, "common"),
  wallet(3, 20, 144, "legendary"), wallet(4, 15, 145, "rare"),
  wallet(5, 10, 147, "common"),    wallet(6, 18, 146, "common"),
  wallet(7, 15, 149, "rare"),      wallet(8, 7, 148, "legendary"),
  wallet(9, 8, 143, "rare"),
];
const WEEKLY_ROWS = [
  wallet(11, 31, 92, "legendary"), wallet(12, 19, 42, "rare"),
  wallet(13, 16, 65, "legendary"), wallet(14, 12, 11, "rare"),
  wallet(15, 17, 27, "common"),    wallet(16, 9, 78, "common"),
  wallet(17, 22, 36, "common"),    wallet(18, 14, 55, "rare"),
  wallet(19, 19, 43, "common"),
];

const fmt = n => n.toLocaleString("en-US");
const short = a => a.slice(0, 10) + "…" + a.slice(-4);

function makeWheel(canvasId, pool, rows) {
  const canvas = document.getElementById(canvasId);
  const model = new TicketModel({ tickets: rows }, { maxSectors: 48 });
  const r = new WheelRenderer(canvas, { pool });
  r.setPool(pool).setModel(model);

  const fit = () => {
    const w = canvas.clientWidth || 520;
    canvas.style.height = w + "px";
    r.resize();
  };
  addEventListener("resize", fit);
  requestAnimationFrame(fit);

  r.idle();
  r.start();
  return { r, model };
}

const daily  = makeWheel("cv-daily",  "daily",  DAILY_ROWS);
const weekly = makeWheel("cv-weekly", "weekly", WEEKLY_ROWS);

/* ---- daily ---- */
const PRIZE_DAILY = 216200;
function runDaily() {
  const idx = Math.floor(Math.random() * daily.model.total);
  const sector = daily.model.sectorForIndex(idx);
  daily.r.onLanded = () => {
    document.getElementById("dw-id").textContent = "#" + (sector.meta.tokenId ?? "—");
    document.getElementById("dw-tier").textContent = (sector.meta.tier || "common").toUpperCase();
    document.getElementById("dw-addr").textContent = short(sector.address);
    document.getElementById("dw-prize").textContent = fmt(PRIZE_DAILY) + " LUNC";
    document.getElementById("dw-idx").textContent =
      "билет #" + idx + " из " + daily.model.total +
      " · сектор №" + sector.number + " · " + sector.entries + " билетов";
  };
  daily.r.spinToIndex(idx);
}
document.getElementById("run-daily").onclick = runDaily;
document.getElementById("pre-daily").onclick = () => daily.r.preDraw();

/* ---- weekly: три места подряд ---- */
const WEEKLY_PRIZES = [888000, 370000, 222000];
const PLACES = ["1ST PLACE", "2ND PLACE", "3RD PLACE"];
function runWeekly() {
  const list = document.getElementById("wk-list");
  list.innerHTML = "";
  const taken = new Set();
  let place = 0;

  const step = () => {
    if (place >= 3) return;
    let idx, sector, guard = 0;
    do {
      idx = Math.floor(Math.random() * weekly.model.total);
      sector = weekly.model.sectorForIndex(idx);
    } while (taken.has(sector.address) && guard++ < 200);
    taken.add(sector.address);
    const p = place;

    weekly.r.onLanded = () => {
      const row = document.createElement("div");
      row.className = "card";
      row.style.cssText = "margin-top:8px;padding:10px;border-color:rgba(185,140,255,.35)";
      row.innerHTML =
        '<div class="cap" style="margin:0 0 4px">' + PLACES[p] + " · #" + (sector.meta.tokenId ?? "—") + "</div>" +
        '<div class="addr">' + short(sector.address) + "</div>" +
        '<div class="prize" style="font-size:15px">' + fmt(WEEKLY_PRIZES[p]) + " LUNC</div>";
      list.appendChild(row);
      place++;
      setTimeout(step, 1600);
    };
    weekly.r.spinToIndex(idx);
  };
  step();
}
document.getElementById("run-weekly").onclick = runWeekly;
document.getElementById("pre-weekly").onclick = () => weekly.r.preDraw();

/* ---- живой обратный отсчёт ---- */
const target = Date.now() + (3 * 3600 + 11 * 60 + 4) * 1000;
setInterval(() => {
  let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600);  s %= 3600;
  const m = Math.floor(s / 60);    s %= 60;
  const pad = v => String(v).padStart(2, "0");
  document.getElementById("d-d").textContent = pad(d);
  document.getElementById("d-h").textContent = pad(h);
  document.getElementById("d-m").textContent = pad(m);
  document.getElementById("d-s").textContent = pad(s);
}, 1000);

/* стартовое состояние карточки победителя */
(() => {
  const s = daily.model.sectors[2];
  document.getElementById("dw-id").textContent = "#" + s.meta.tokenId;
  document.getElementById("dw-tier").textContent = (s.meta.tier || "common").toUpperCase();
  document.getElementById("dw-addr").textContent = short(s.address);
  document.getElementById("dw-idx").textContent = "предыдущий раунд";
})();
