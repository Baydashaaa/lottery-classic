/**
 * dev/_test_schedule.js — сторож расписания розыгрышей.
 *
 * Проверяет:
 *   1. draw-schedule.js отвечает правильно в каждый день недели и на границах
 *   2. DrawClock.js (внутри бандла V2) считает ТО ЖЕ САМОЕ — почасово на 2 недели.
 *      Единственная защита от того, что две реализации разъедутся молча
 *   3. app.js и treasury.js не завели себе новых копий той же арифметики
 *
 * Запуск: node dev/_test_schedule.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'draw-schedule.js'))
  ? __dirname                       // файлы лежат рядом (как отдан пакет)
  : path.join(__dirname, '..');     // обычная раскладка репо

function read(rel, alts) {
  for (const p of [rel].concat(alts || [])) {
    const full = path.join(ROOT, p);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
  }
  return null;
}

let fails = 0;
function check(name, got, want) {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + '  →  ' + got +
    (ok ? '' : '   (ждали ' + want + ')'));
}

const schedSrc = read('draw-schedule.js', ['assets/js/draw-schedule.js']);
if (!schedSrc) { console.error('FAIL: draw-schedule.js не найден'); process.exit(1); }
const window = {};
eval(schedSrc);
const S = window.DRAW_SCHEDULE;
const D = ['вс','пн','вт','ср','чт','пт','сб'];

console.log('\n[1] Каждый день недели, 17:03 и 21:03 UTC');
for (let day = 3; day <= 9; day++) {            // 2026-08-03 = понедельник
  for (const hour of [17, 21]) {
    const now = new Date(Date.UTC(2026, 7, day, hour, 3, 0));
    const dn = S.next('daily', now), wn = S.next('weekly', now);
    const okD = dn > now && dn.getUTCHours() === 20 && dn.getUTCDay() !== 1;
    const okW = wn > now && wn.getUTCHours() === 20 && wn.getUTCDay() === 1;
    if (!okD || !okW) fails++;
    console.log((okD && okW ? '  ok   ' : '  FAIL ') +
      '2026-08-' + String(day).padStart(2,'0') + ' ' + D[now.getUTCDay()] + ' ' + hour + ':03' +
      '   daily → ' + dn.toISOString().slice(0,16) + ' ' + D[dn.getUTCDay()] +
      '   weekly → ' + wn.toISOString().slice(0,16) + ' ' + D[wn.getUTCDay()]);
  }
}

console.log('\n[2] Момент со скриншотов — пн 2026-08-03 17:03 UTC');
const shot = new Date(Date.UTC(2026, 7, 3, 17, 3, 0));
check('daily  → вт 20:00Z', S.next('daily',  shot).toISOString(), '2026-08-04T20:00:00.000Z');
check('weekly → пн 20:00Z', S.next('weekly', shot).toISOString(), '2026-08-03T20:00:00.000Z');
check('формат daily',       S.format(S.msToNext('daily',  shot)), '1d 02:57');
check('формат weekly',      S.format(S.msToNext('weekly', shot)), '02:57:00');
check('isPausedToday daily (пн)',  S.isPausedToday('daily',  shot), 'true');
check('isPausedToday weekly (пн)', S.isPausedToday('weekly', shot), 'false');
const pp = S.parts(S.msToNext('daily', shot));
check('флип-счётчик daily d/h/m', pp.d + '/' + pp.h + '/' + pp.m, '1/2/57');

console.log('\n[3] Границы');
check('вт 20:00:00 → daily завтра',
  S.next('daily', new Date(Date.UTC(2026,7,4,20,0,0))).toISOString(), '2026-08-05T20:00:00.000Z');
check('вт 19:59:59 → daily сегодня',
  S.next('daily', new Date(Date.UTC(2026,7,4,19,59,59))).toISOString(), '2026-08-04T20:00:00.000Z');
check('вс 21:00 → daily перепрыгивает пн',
  S.next('daily', new Date(Date.UTC(2026,7,9,21,0,0))).toISOString(), '2026-08-11T20:00:00.000Z');
check('пн 20:30 → weekly через неделю',
  S.next('weekly', new Date(Date.UTC(2026,7,3,20,30,0))).toISOString(), '2026-08-10T20:00:00.000Z');
check('prev daily в пн 17:03 → вс 20:00',
  S.prev('daily', shot).toISOString(), '2026-08-02T20:00:00.000Z');

console.log('\n[4] Формат');
check('26ч57м',      S.format((26*3600 + 57*60) * 1000), '1d 02:57');
check('2ч57м23с',    S.format((2*3600 + 57*60 + 23) * 1000), '02:57:23');
check('ровно сутки', S.format(86400 * 1000), '1d 00:00');
check('ноль',        S.format(0), '00:00:00');
check('минус',       S.format(-5000), '00:00:00');

console.log('\n[5] draw-schedule.js vs DrawClock.js — почасово, 2 недели');
const clockSrc = read('DrawClock.js', ['assets/js/draw-v2/DrawClock.js']);
if (!clockSrc) {
  console.log('  ПРОПУЩЕНО: DrawClock.js не найден рядом');
} else {
  const CONFIG = {
    DAILY: 'daily', WEEKLY: 'weekly',
    DRAW_HOUR_UTC: 20, DRAW_MINUTE_UTC: 0,
    WEEKLY_WEEKDAY_UTC: 1, DAILY_SKIPS_WEEKLY_DAY: true
  };
  const body = clockSrc
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/^export\s+/gm, '');
  eval(body);

  let mismatch = 0, checked = 0;
  const t0 = Date.UTC(2026, 7, 3, 0, 0, 0);
  for (let h = 0; h < 24 * 14; h++) {
    const now = t0 + h * 3600000;
    for (const pool of ['daily', 'weekly']) {
      checked++;
      const a = S.next(pool, new Date(now));
      const b = nextDeadline(pool, now);
      if (!a || b === null || a.getTime() !== b) {
        mismatch++;
        if (mismatch <= 5) {
          console.log('  FAIL ' + new Date(now).toISOString() + ' ' + pool +
            '  schedule=' + (a && a.toISOString()) +
            '  clock=' + (b === null ? 'null' : new Date(b).toISOString()));
        }
      }
    }
  }
  let fmtBad = 0;
  for (const ms of [0, 1000, 59000, 3600000, 86400000 - 1, 86400000, 96000000, 700000000]) {
    if (S.format(ms) !== formatCountdown(ms)) {
      fmtBad++;
      console.log('  FAIL формат при ms=' + ms +
        '  schedule=' + S.format(ms) + '  clock=' + formatCountdown(ms));
    }
  }
  fails += mismatch + fmtBad;
  console.log('  ' + (mismatch === 0 ? 'ok   ' : 'FAIL ') +
    'дедлайны: сверено ' + checked + ', расхождений ' + mismatch);
  console.log('  ' + (fmtBad === 0 ? 'ok   ' : 'FAIL ') +
    'формат: расхождений ' + fmtBad);
}

console.log('\n[6] Своей арифметики времени в потребителях нет');
for (const [name, alts] of [['app.js', ['assets/js/app.js']],
                            ['treasury.js', ['assets/js/treasury.js']]]) {
  const src = read(name, alts);
  if (!src) { console.log('  ПРОПУЩЕНО: ' + name + ' не найден'); continue; }
  const bad = [];
  if (/setUTCHours\s*\(\s*20/.test(src))             bad.push('setUTCHours(20…)');
  if (/getUTCDay\s*\(\s*\)\s*[!=]==?\s*1\b/.test(src)) bad.push('сравнение getUTCDay() с 1');
  const ok = bad.length === 0;
  if (!ok) fails++;
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + name +
    (ok ? '  — считает только через DRAW_SCHEDULE' : '  — найдено: ' + bad.join(', ')));
}

console.log('\n' + (fails === 0 ? '=== ВСЁ ЗЕЛЁНОЕ ===' : '=== ' + fails + ' ПРОВАЛОВ ==='));
process.exit(fails === 0 ? 0 : 1);
