/* ─────────────────────────────────────────────────────────────────────────
   HOME HERO - живое колесо и живые цифры на главной (#page-home).

   Сознательно НЕ зависит от oracle-draw.bundle.js: это отдельный лёгкий
   рендерер только для витрины. Движок V2 (DrawBridge/DrawEngine) остаётся
   единоличным хозяином канваса на вкладке Draw - два потребителя одного
   движка мы уже проходили на рассинхроне пула 3 авг.

   Данные берём только через то, что app.js уже выставил наружу:
     window.OracleDrawUI.participants()  - участники текущего раунда
     window._dailyPoolBalance / _weekly  - баланс пула в LUNC
     window.DRAW_SCHEDULE                - расписание и отсчёт
     winnersData                         - победители (глобальный let app.js)
   Ничего своего не считает: своя арифметика расписания - это ровно то,
   что разъехалось 3 авг 2026 в трёх копиях.
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var PRIZE_SHARE = 0.80;
  var MAX_SECTORS = 40;

  var THEME = {
    daily:  { main: '#F5C842', dim: 'rgba(245,200,66,0.22)', soft: 'rgba(245,200,66,0.08)' },
    weekly: { main: '#7C5CFF', dim: 'rgba(124,92,255,0.22)', soft: 'rgba(124,92,255,0.08)' }
  };
  var TIER = { common: '#C8D4E8', rare: '#60a5fa', legendary: '#fb923c' };

  var canvas = null, ctx = null;
  var raf = null, tickTimer = null;
  var angle = 0, lastT = 0, active = false;
  var pool = 'daily';
  var model = [];
  var reduced = false;

  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  function $(id) { return document.getElementById(id); }

  function fmtLunc(n) {
    if (typeof window.fmt === 'function') return window.fmt(n);
    try { return fmt(n); } catch (e) {}
    return Math.round(n || 0).toLocaleString('en-US');
  }

  function shortAddr(a) {
    return a ? a.slice(0, 8) + '…' + a.slice(-4) : '';
  }

  function winners() {
    try { if (typeof winnersData !== 'undefined' && Array.isArray(winnersData)) return winnersData; } catch (e) {}
    return [];
  }

  function participants() {
    try {
      if (window.OracleDrawUI && typeof window.OracleDrawUI.participants === 'function') {
        var p = window.OracleDrawUI.participants();
        return Array.isArray(p) ? p : [];
      }
    } catch (e) {}
    return [];
  }

  function poolBalance() {
    var b = pool === 'weekly' ? window._weeklyPoolBalance : window._dailyPoolBalance;
    return (typeof b === 'number' && isFinite(b)) ? b : 0;
  }

  /* ── модель секторов ──────────────────────────────────────────────────── */

  function buildModel() {
    var list = participants().map(function (p) {
      return {
        addr:    p[0],
        entries: Math.max(1, Number(p[1]) || 1),
        tier:    (p[3] || 'common').toLowerCase()
      };
    }).filter(function (p) { return !!p.addr; });

    list.sort(function (a, b) { return b.entries - a.entries; });

    if (list.length > MAX_SECTORS) {
      var head = list.slice(0, MAX_SECTORS - 1);
      var tail = list.slice(MAX_SECTORS - 1);
      var sum  = tail.reduce(function (s, x) { return s + x.entries; }, 0);
      head.push({ addr: null, entries: sum, tier: 'common', group: tail.length });
      list = head;
    }

    var total = list.reduce(function (s, x) { return s + x.entries; }, 0);
    var from = -Math.PI / 2;
    list.forEach(function (s) {
      s.span = total > 0 ? (s.entries / total) * Math.PI * 2 : 0;
      s.from = from;
      from += s.span;
    });

    model = list;
    return { count: list.length, entries: total };
  }

  /* ── отрисовка ───────────────────────────────────────────────────────── */

  function resize() {
    if (!canvas) return false;
    var box = canvas.parentElement;
    var css = Math.max(220, Math.min(box ? box.clientWidth : 420, 460));
    if (!css || css < 40) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(css * dpr)) {
      canvas.width  = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
      canvas.style.width  = css + 'px';
      canvas.style.height = css + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas._css = css;
    return true;
  }

  function drawEmpty(cx, cy, R, th) {
    var rFace = R * 0.86, rHub = R * 0.30, i, a0, a1;
    for (i = 0; i < 12; i++) {
      a0 = angle + (i / 12) * Math.PI * 2;
      a1 = angle + ((i + 1) / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rHub, cy + Math.sin(a0) * rHub);
      ctx.arc(cx, cy, rFace, a0, a1);
      ctx.lineTo(cx + Math.cos(a1) * rHub, cy + Math.sin(a1) * rHub);
      ctx.arc(cx, cy, rHub, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.030)' : 'rgba(255,255,255,0.055)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(159,176,208,0.75)';
    ctx.font = '500 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting entries', cx, cy + R * 0.62);
  }

  function drawSectors(cx, cy, R) {
    var rFace = R * 0.86, rHub = R * 0.30;
    model.forEach(function (s) {
      var a0 = angle + s.from, a1 = a0 + s.span;
      var col = TIER[s.tier] || TIER.common;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rHub, cy + Math.sin(a0) * rHub);
      ctx.arc(cx, cy, rFace, a0, a1);
      ctx.lineTo(cx + Math.cos(a1) * rHub, cy + Math.sin(a1) * rHub);
      ctx.arc(cx, cy, rHub, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = col + '2e';
      ctx.fill();
      ctx.strokeStyle = col + '80';
      ctx.lineWidth = 1;
      ctx.stroke();

      // дуга редкости у обода
      ctx.beginPath();
      ctx.arc(cx, cy, rFace - 3, a0 + 0.01, a1 - 0.01);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();

      // подпись - только если сектор достаточно широкий
      var mid = a0 + s.span / 2;
      var arcPx = s.span * rFace;
      if (arcPx > 26) {
        var tx = cx + Math.cos(mid) * (R * 0.58);
        var ty = cy + Math.sin(mid) * (R * 0.58);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = col;
        ctx.font = '500 13px Inter, sans-serif';
        ctx.fillText(s.group ? '+' + s.group : String(s.entries), tx, ty);
        if (arcPx > 62 && s.addr) {
          ctx.fillStyle = 'rgba(230,236,255,0.55)';
          ctx.font = '400 10px monospace';
          ctx.fillText(s.addr.slice(-6), tx, ty + 14);
        }
      }
    });
  }

  function drawHub(cx, cy, R, th) {
    var rHub = R * 0.30, i, a;
    ctx.beginPath();
    ctx.arc(cx, cy, rHub, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11,15,26,0.92)';
    ctx.fill();
    ctx.strokeStyle = th.dim;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // спицы как в логотипе
    for (i = 0; i < 8; i++) {
      a = angle * 0.6 + (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rHub * 0.32, cy + Math.sin(a) * rHub * 0.32);
      ctx.lineTo(cx + Math.cos(a) * rHub * 0.82, cy + Math.sin(a) * rHub * 0.82);
      ctx.strokeStyle = th.main;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rHub * 0.82, cy + Math.sin(a) * rHub * 0.82, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = th.main;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rHub * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = th.main;
    ctx.fill();
  }

  function draw() {
    if (!ctx || !canvas._css) return;
    var w = canvas._css, cx = w / 2, cy = w / 2, R = w / 2 - 8;
    var th = THEME[pool] || THEME.daily;

    ctx.clearRect(0, 0, w, w);

    // обод
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = th.dim;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.895, 0, Math.PI * 2);
    ctx.strokeStyle = th.soft;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!model.length) drawEmpty(cx, cy, R, th);
    else drawSectors(cx, cy, R);

    drawHub(cx, cy, R, th);
  }

  function frame(t) {
    if (!active) return;
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;
    lastT = t;
    if (!reduced) angle += dt * 0.10;
    draw();
    raf = requestAnimationFrame(frame);
  }

  /* ── живые цифры ─────────────────────────────────────────────────────── */

  function paintNumbers() {
    var balance = poolBalance();
    var prize   = balance * PRIZE_SHARE;
    var stats   = buildModel();

    var elPrize = $('hh-prize');
    if (elPrize) elPrize.textContent = balance > 0 ? fmtLunc(prize) : '-';

    var elSub = $('hh-prize-sub');
    if (elSub) elSub.textContent = balance > 0
      ? '80% of ' + fmtLunc(balance) + ' LUNC in the pool'
      : 'Pool is filling up';

    var elW = $('hh-wallets');
    if (elW) elW.textContent = stats.count;
    var elE = $('hh-entries');
    if (elE) elE.textContent = stats.entries;

    var ms = 0;
    try { ms = window.DRAW_SCHEDULE.msToNext(pool); } catch (e) {}
    var p = null;
    try { p = window.DRAW_SCHEDULE.parts(ms); } catch (e) {}
    var elC = $('hh-countdown');
    if (elC && p) {
      elC.textContent = (p.d > 0 ? p.d + 'd ' : '') +
        String(p.h).padStart(2, '0') + ':' +
        String(p.m).padStart(2, '0') + ':' +
        String(p.s).padStart(2, '0');
    }
  }

  function paintTicker() {
    var host = $('hh-ticker');
    if (!host) return;
    var list = winners().filter(function (w) { return w.winner; }).slice(0, 4);
    if (!list.length) {
      host.innerHTML = '<span class="hh-tick-empty">No draws recorded yet</span>';
      return;
    }
    host.innerHTML = list.map(function (w) {
      var when = w.time ? new Date(w.time * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
      return '<span class="hh-tick">' +
        '<i class="hh-dot hh-dot-' + (w.type === 'weekly' ? 'w' : 'd') + '"></i>' +
        '<b>' + shortAddr(w.winner) + '</b>' +
        '<em>' + fmtLunc(w.paid || w.prize || 0) + ' LUNC</em>' +
        '<s>' + when + '</s></span>';
    }).join('');
  }

  function paintPaidStat() {
    var el = $('home-stat-paid');
    if (!el) return;
    var total = winners().reduce(function (s, w) { return s + (w.paid || w.prize || 0); }, 0);
    el.textContent = total > 0 ? fmtLunc(total) : '-';
  }

  function paintPoolTabs() {
    ['daily', 'weekly'].forEach(function (p) {
      var b = $('hh-tab-' + p);
      if (b) b.classList.toggle('active', p === pool);
    });
    var lbl = $('hh-pool-label');
    if (lbl) lbl.textContent = pool === 'weekly' ? 'Weekly draw' : 'Daily draw';
    var hero = $('hh-hero');
    if (hero) hero.setAttribute('data-pool', pool);
  }

  function refresh() {
    paintPoolTabs();
    paintNumbers();
    paintTicker();
    paintPaidStat();
  }

  /* ── жизненный цикл ──────────────────────────────────────────────────── */

  function visible() {
    var page = $('page-home');
    return !!page && page.style.display !== 'none' && !document.hidden;
  }

  function activate(retry) {
    canvas = $('hh-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    pool = (window.currentLottery === 'weekly') ? 'weekly' : 'daily';

    // канвас может быть ещё не в потоке (страница только что показана) -
    // тогда clientWidth = 0 и колесо навсегда останется в аварийном размере.
    if (!resize()) {
      if ((retry || 0) < 12) setTimeout(function () { activate((retry || 0) + 1); }, 200);
      return;
    }

    if (active) return;
    active = true;
    lastT = 0;
    refresh();
    raf = requestAnimationFrame(frame);
    tickTimer = setInterval(function () { if (visible()) refresh(); }, 1000);
    window.addEventListener('resize', onResize);
  }

  function deactivate() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    window.removeEventListener('resize', onResize);
  }

  function onResize() { if (resize()) draw(); }

  document.addEventListener('visibilitychange', function () {
    if (!$('page-home') || $('page-home').style.display === 'none') return;
    if (document.hidden) deactivate();
    else activate();
  });

  /* ── наружу ──────────────────────────────────────────────────────────── */

  window.HomeHero = {
    activate:   activate,
    deactivate: deactivate,
    refresh:    refresh,
    setPool: function (p) {
      pool = (p === 'weekly') ? 'weekly' : 'daily';
      refresh();
      draw();
    }
  };

  // Переключатель пула на главной ведёт за собой всё приложение - один
  // источник правды, иначе колесо витрины и вкладка Draw снова разъедутся.
  window.homeSetPool = function (p) {
    if (typeof switchLottery === 'function') { try { switchLottery(p); } catch (e) {} }
    window.HomeHero.setPool(p);
  };

  window.homeMint = function () {
    if (typeof showTab === 'function') showTab('draw');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (typeof openModal === 'function') openModal();
      });
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    var page = $('page-home');
    if (page && page.style.display !== 'none') activate();
  });
})();
