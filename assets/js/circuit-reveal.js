/* ═══════════════════════════════════════════════════════════════════════════
   CIRCUIT - показ розыгрыша
   ---------------------------------------------------------------------------
   На странице написано «A marker runs across it and stops on one», но самого
   бегунка в коде не было: раунд закрывался, доска молча обнулялась, и человек
   видел только пустое поле. Этот файл закрывает разрыв между обещанием и тем,
   что происходит на экране.

   ПОДКЛЮЧЕНИЕ: обычный <script>, ПОСЛЕ circuit-board.js (нужна та же палитра
   и та же доска).

   Откуда данные: /circuit/history отдаёт закрытый раунд целиком - winnerZone,
   winner, sold, blocks, split.prize, txWinner. Ничего считать заново не надо,
   воркер и скрипт выплат тут не участвуют. Показ - чистая косметика поверх уже
   состоявшегося результата, повлиять на деньги он не может по построению.

   Как ловим момент: сравниваем roundId из /circuit/state с прошлым. Сменился -
   значит предыдущий только что разыгран, и его надо показать. Опрос свой, раз
   в 5 секунд, чтобы не зависеть от двадцатисекундного круга доски.

   Пока идёт показ, поднят флаг window.__circuitRevealBusy: circuit-board.js и
   refreshCircuit() в index.html на нём выходят сразу, иначе они затёрли бы
   старую доску новым пустым раундом прямо посреди пробега.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const POLL_MS = 5000;
  const SPIN_MS = 9000;    // сам пробег
  const HOLD_MS = 9000;    // сколько держим итог перед возвратом к доске
  const MAX_AGE_MS = 5 * 60 * 1000;  // раунд старше пяти минут не показываем
  const LS_KEY = 'circuitRevealShown';

  // Палитра и золотой - те же, что в circuit-board.js. Дублируются намеренно:
  // связывать два файла ради десяти строк дороже, чем разойтись в оттенках.
  const GOLD = '#f4d03f';
  const PALETTE = [
    '#38d9d0', '#7ec8ff', '#a78bfa', '#ff8fa3', '#7ee787',
    '#ffb86b', '#5eead4', '#c4b5fd', '#fca5a5', '#86efac',
  ];
  const GREY = '#5b6b78';

  const $ = (id) => document.getElementById(id);
  const base = () => (typeof DRAW_WORKER !== 'undefined' ? DRAW_WORKER : '');
  const short = (a) => String(a).slice(0, 9) + '…' + String(a).slice(-4);
  const lunc = (u) => Math.round(u / 1e6).toLocaleString('en-US');

  const ADDR_RE = /^terra1[0-9a-z]{38}$/i;
  function myWallet() {
    const ok = (v) => (typeof v === 'string' && ADDR_RE.test(v)) ? v : null;
    let a = null;
    try { a = ok(connectedWalletAddress); } catch (e) {}
    if (!a) { try { a = ok(lotteryAddress); } catch (e) {} }
    if (!a && typeof window._getConnectedAddress === 'function') {
      try { a = ok(window._getConnectedAddress()); } catch (e) {}
    }
    return a;
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  const REDUCED = typeof matchMedia === 'function' &&
                  matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── что уже показывали ────────────────────────────────────────────────── */
  // Без этого перезагрузка страницы крутила бы один и тот же раунд заново.
  function alreadyShown(id) {
    try { return localStorage.getItem(LS_KEY) === id; } catch (e) { return false; }
  }
  function markShown(id) {
    try { localStorage.setItem(LS_KEY, id); } catch (e) {}
  }

  /* ── стили ─────────────────────────────────────────────────────────────── */

  function ensureStyle() {
    if ($('cr-style')) return;
    const s = document.createElement('style');
    s.id = 'cr-style';
    s.textContent = `
      @keyframes cr-win-pulse {
        0%, 100% { box-shadow: 0 0 10px rgba(244,208,63,.75); }
        50%      { box-shadow: 0 0 22px rgba(244,208,63,1); }
      }
      #cr-caption { margin-top: 12px; font-size: 13px; line-height: 1.6; color: #cfe9e7;
        background: rgba(244,208,63,.07); border: 1px solid rgba(244,208,63,.32);
        border-radius: 9px; padding: 10px 14px; }
      #cr-caption b { color: ${GOLD}; }
      #cr-caption a { color: #a8ece8; }
      #cr-caption .cr-sub { display: block; color: #7fa8a5; font-size: 12px; margin-top: 3px; }
    `;
    document.head.appendChild(s);
  }

  function caption(html) {
    ensureStyle();
    let el = $('cr-caption');
    if (!el) {
      const board = $('cir-board');
      if (!board) return;
      el = document.createElement('div');
      el.id = 'cr-caption';
      board.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = html;
  }
  function dropCaption() {
    const el = $('cr-caption');
    if (el) el.remove();
  }

  /* ── раскладка закрытого раунда ────────────────────────────────────────── */

  function holdersOf(round, me) {
    const order = [], map = {};
    const mine = me ? me.toLowerCase() : null;
    for (const b of round.blocks || []) {
      const key = String(b.wallet).toLowerCase();
      if (!map[key]) {
        map[key] = { wallet: b.wallet, ranges: [], mine: key === mine, idx: order.length };
        order.push(map[key]);
      }
      map[key].ranges.push([b.from, b.to]);
    }
    for (const h of order) h.color = h.idx < PALETTE.length ? PALETTE[h.idx] : GREY;
    return order;
  }

  // Красим доску под закрытый раунд и запоминаем стиль каждой клетки: бегунок
  // будет их временно подменять и обязан вернуть как было.
  function paintClosed(round, me) {
    const bd = $('cir-board');
    if (!bd || !bd.children.length) return null;
    const styles = new Array(bd.children.length).fill('');

    for (let k = 0; k < bd.children.length; k++) {
      const c = bd.children[k];
      // Непроданное поле гасим, чтобы взгляд держался на живой части доски
      c.style.cssText = k < round.sold ? 'opacity:.55' : 'opacity:.25';
    }
    for (const h of holdersOf(round, me)) {
      for (const [from, to] of h.ranges) {
        for (let k = from; k <= to && k < bd.children.length; k++) {
          const c = bd.children[k];
          if (!c) continue;
          c.style.background = h.mine ? 'rgba(244,208,63,.62)' : hexA(h.color, .48);
          c.style.outline = '1px solid ' + (h.mine ? GOLD : hexA(h.color, .85));
          c.style.opacity = '.55';
        }
      }
    }
    for (let k = 0; k < bd.children.length; k++) styles[k] = bd.children[k].style.cssText;
    return styles;
  }

  function clearBoard() {
    const bd = $('cir-board');
    if (!bd) return;
    Array.prototype.forEach.call(bd.children, (c) => { c.style.cssText = ''; });
  }

  /* ── пробег ────────────────────────────────────────────────────────────── */

  // Квадратичный ease-in-out: трогается мягко, разгоняется к середине и так
  // же мягко замирает. Кривая считает ПУТЬ, а не скорость, поэтому остановка
  // приходится ровно на выигрышную зону - без доводки рывком в конце.
  //
  // Кубическая версия смотрелась хуже: первую секунду бегунок стоял на месте
  // (ноль шагов), и это читалось как зависший интерфейс, а не как разгон.
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  function markCell(c) {
    c.style.background = 'rgba(255,255,255,.92)';
    c.style.outline = '1px solid #ffffff';
    c.style.boxShadow = '0 0 14px rgba(255,255,255,.85)';
    c.style.opacity = '1';
  }

  function spin(round, styles) {
    return new Promise((done) => {
      const bd = $('cir-board');
      const sold = round.sold;
      const win = round.winnerZone;
      if (!bd || !sold || typeof win !== 'number') return done();

      // Кругов тем меньше, чем длиннее ряд: на короткой доске два круга дают
      // разгон до одиннадцати зон в секунду в пике, на длинной хватает одного.
      const laps = sold >= 120 ? 1 : 2;
      const total = laps * sold + win;      // финиш ровно на победителе
      const t0 = performance.now();
      let prev = -1;

      function frame(now) {
        const t = Math.min(1, (now - t0) / SPIN_MS);
        const idx = Math.floor(ease(t) * total) % sold;
        if (idx !== prev) {
          if (prev >= 0 && bd.children[prev]) bd.children[prev].style.cssText = styles[prev];
          if (bd.children[idx]) markCell(bd.children[idx]);
          prev = idx;
        }
        if (t < 1) requestAnimationFrame(frame);
        else done();
      }
      requestAnimationFrame(frame);
    });
  }

  function landOn(round) {
    const bd = $('cir-board');
    const c = bd && bd.children[round.winnerZone];
    if (!c) return;
    c.style.background = 'rgba(244,208,63,.85)';
    c.style.outline = '2px solid ' + GOLD;
    c.style.opacity = '1';
    c.style.animation = 'cr-win-pulse 1.2s ease-in-out infinite';
  }

  /* ── показ целиком ─────────────────────────────────────────────────────── */

  async function play(round) {
    if (!round || round.status !== 'closed') return;
    if (typeof round.winnerZone !== 'number') return;
    const bd = $('cir-board');
    if (!bd || !bd.children.length) return;

    window.__circuitRevealBusy = true;
    markShown(round.roundId);

    const me = myWallet();
    const won = me && String(round.winner).toLowerCase() === me.toLowerCase();
    const prize = (round.split && round.split.prize) ? lunc(round.split.prize) : null;

    try {
      const styles = paintClosed(round, me);
      caption('<b>Drawing…</b><span class="cr-sub">the marker is running across ' +
              round.sold + ' claimed zones</span>');

      if (!REDUCED && styles) await spin(round, styles);
      landOn(round);

      const link = round.txWinner
        ? ' · <a href="https://finder.terraport.finance/mainnet/tx/' + round.txWinner +
          '" target="_blank" rel="noopener">transaction</a>'
        : '';
      caption(
        '<b>' + (won ? 'You won ' + (prize ? prize + ' LUNC' : 'this round') + '!'
                     : 'Zone ' + round.winnerZone + ' takes the round') + '</b>' +
        '<span class="cr-sub">' +
          (won ? 'Zone ' + round.winnerZone : short(round.winner)) +
          (prize && !won ? ' · ' + prize + ' LUNC' : '') +
          ' · ' + round.sold + ' zones claimed' + link +
        '</span>'
      );

      await new Promise((r) => setTimeout(r, HOLD_MS));
    } finally {
      clearBoard();
      dropCaption();
      window.__circuitRevealBusy = false;
    }
  }

  /* ── ловля момента ─────────────────────────────────────────────────────── */

  async function history(limit) {
    try {
      const r = await fetch(base() + '/circuit/history?limit=' + limit,
                            { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const d = await r.json();
      return (d && Array.isArray(d.rounds)) ? d.rounds : [];
    } catch (e) { return []; }
  }

  let lastRoundId = null;

  async function tick() {
    if (window.__circuitRevealBusy) return;
    if (!$('cir-board')) return;

    let st;
    try {
      const r = await fetch(base() + '/circuit/state', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      st = await r.json();
    } catch (e) { return; }
    if (!st || !st.roundId) return;

    // Первый заход: показываем только совсем свежий розыгрыш. Иначе человек,
    // зашедший через час, получил бы пробег по давно закрытому раунду.
    if (lastRoundId === null) {
      lastRoundId = st.roundId;
      const rounds = await history(3);
      const last = rounds.filter((r) => r && r.status === 'closed')[0];
      if (last && !alreadyShown(last.roundId) &&
          last.closedAt && (Date.now() - new Date(last.closedAt).getTime()) < MAX_AGE_MS) {
        await play(last);
      }
      return;
    }

    if (st.roundId === lastRoundId) return;

    const closed = lastRoundId;
    lastRoundId = st.roundId;
    if (alreadyShown(closed)) return;

    // Раунды, слитые из-за недобора, в историю не пишутся - если предыдущего
    // там нет, значит розыгрыша не было и показывать нечего.
    const rounds = await history(5);
    const round = rounds.find((r) => r && r.roundId === closed);
    if (round) await play(round);
  }

  /* ── проверка без ожидания раунда ──────────────────────────────────────── */
  // Раунд закрывается раз в три часа, и ловить показ вживую - это караулить
  // экран полдня. С ?revealtest=1 в адресе последний закрытый раунд
  // проигрывается сразу и столько раз, сколько перезагрузишь страницу:
  // отметка «уже показывали» в тестовом режиме не ставится и не читается.
  //
  // Ключ ничего не меняет на цепи и никому, кроме открывшего эту ссылку, не
  // виден - розыгрыш давно состоялся, мы лишь перерисовываем его результат.
  async function selfTest() {
    const rounds = await history(5);
    const last = rounds.filter((r) => r && r.status === 'closed')[0];
    if (!last) {
      caption('<b>Nothing to replay</b><span class="cr-sub">' +
              '/circuit/history has no closed rounds yet</span>');
      return;
    }
    const keep = (() => { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } })();
    await play(last);
    // Возвращаем отметку как была, чтобы проверка не съела показ настоящего
    // раунда у того, кто потом откроет страницу обычной ссылкой.
    try {
      if (keep === null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, keep);
    } catch (e) {}
  }

  function boot() {
    if (!$('stage-circuit')) return;

    if (/[?&]revealtest=1/.test(location.search)) {
      // Доску строит refreshCircuit() из index.html; до этого клеток нет и
      // красить нечего. Ждём её появления, но не бесконечно.
      let waited = 0;
      const wait = setInterval(() => {
        const bd = $('cir-board');
        if (bd && bd.children.length) { clearInterval(wait); selfTest(); }
        else if (++waited > 40) clearInterval(wait);
      }, 400);
      return;
    }

    tick();
    setInterval(tick, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
