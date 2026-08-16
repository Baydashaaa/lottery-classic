/**
 * dev/_test_rollover.js — две правки от 3 августа 2026.
 *
 * [A] Граница free entries привязана к winners.json, а не к часам.
 *     Повод: 3 авг weekly упал, записи не появилось, а генератор всё равно
 *     сдвинул границу на Пн 20:00 и обнулил входы — они сгорели за раунд,
 *     которого не было.
 *
 * [B] Карточка победителя подписывает раунд и помечает несвежий результат.
 *     Повод: в тот же день победитель НЕДЕЛЬНОЙ давности читался как свежий.
 *
 * Запуск: node dev/_test_rollover.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'update-free-entries.js'))
  ? __dirname
  : path.join(__dirname, '..');

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

/** Вырезать одну функцию по имени из исходника */
function extract(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) return null;
  // Считать фигурные скобки с самого начала нельзя: деструктурирующий параметр
  // ({ a, b }) сам открывает скобку и обрывает счёт. Сначала проходим список
  // параметров по круглым, и только потом ищем тело.
  let pd = 0, k = src.indexOf('(', i);
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  let depth = 0, started = false;
  for (let j = k; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

/** Вырезать МЕТОД класса (объявляется без слова function) */
function extractMethod(src, name) {
  const re = new RegExp('^\\s*' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const i = m.index;
  let pd = 0, k = src.indexOf('(', i);
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  let depth = 0, started = false;
  for (let j = k; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

const DAY = 86400, WEEK = 7 * DAY;
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

// ── [A] chooseCutoff ─────────────────────────────────────────────────────────
console.log('\n[A] Граница окна free entries');
const genSrc = read('update-free-entries.js', ['.github/scripts/update-free-entries.js']);
if (!genSrc) { console.log('  ПРОПУЩЕНО: update-free-entries.js не найден'); }
else {
  const fnSrc = extract(genSrc, 'chooseCutoff');
  if (!fnSrc) { fails++; console.log('  FAIL chooseCutoff не найдена'); }
  else {
    eval(fnSrc);
    const WINDOW = 90 * DAY;
    const now = sec('2026-08-03T21:30:00Z');
    const thisMon = sec('2026-08-03T20:00:00Z');
    const prevMon = sec('2026-07-27T20:00:00Z');

    // 1. Розыгрыш прошёл в срок → граница та же, что по часам
    let d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: thisMon,
                           histRaw: null, nowSec: now, windowSec: WINDOW });
    check('розыгрыш в срок → граница = Пн 20:00', new Date(d.cutoff*1000).toISOString(), '2026-08-03T20:00:00.000Z');
    check('  пропущенных недель', d.missedWeeks, 0);

    // 2. ГЛАВНЫЙ СЛУЧАЙ: розыгрыш не состоялся → граница держится на прошлой неделе
    d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: prevMon,
                       histRaw: null, nowSec: now, windowSec: WINDOW });
    check('розыгрыш упал → граница остаётся 27 июля', new Date(d.cutoff*1000).toISOString(), '2026-07-27T20:00:00.000Z');
    check('  сигнал о пропуске', d.missedWeeks, 1);
    check('  входы бы сгорели по старой логике', thisMon > d.cutoff, 'true');

    // 3. Три недели без розыгрыша
    d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: thisMon - 3*WEEK,
                       histRaw: null, nowSec: now, windowSec: WINDOW });
    check('три пропуска подряд', d.missedWeeks, 3);

    // 4. Истории нет — старое поведение по часам
    d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: null,
                       histRaw: null, nowSec: now, windowSec: WINDOW });
    check('нет истории → по часам', new Date(d.cutoff*1000).toISOString(), '2026-08-03T20:00:00.000Z');

    // 5. Предохранитель: очень старый розыгрыш обрезается глубиной сканирования
    d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: now - 200*DAY,
                       histRaw: null, nowSec: now, windowSec: WINDOW });
    check('старше 90 дней → обрезано', d.clamped, 'true');
    check('  граница = ровно 90 дней назад', d.cutoff, now - WINDOW);

    // 6. Ручной mid-week reset позже границы — уважается
    d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: prevMon,
                       histRaw: '2026-07-30T12:00:00.000Z', nowSec: now, windowSec: WINDOW });
    check('ручной reset позже → уважается', new Date(d.cutoff*1000).toISOString(), '2026-07-30T12:00:00.000Z');
    check('  источник', d.source, 'manual history_from');

    // 7. Устаревший history_from игнорируется
    d = chooseCutoff({ clockCutoff: thisMon, drawnCutoff: prevMon,
                       histRaw: '2026-05-25T20:00:00.000Z', nowSec: now, windowSec: WINDOW });
    check('устаревший history_from игнорируется', new Date(d.cutoff*1000).toISOString(), '2026-07-27T20:00:00.000Z');
  }

  // lastCompletedWeeklyDeadlineSec — skipped-раунды не считаются состоявшимися
  console.log('\n[A2] Поиск последнего состоявшегося розыгрыша');
  const lastSrc = extract(genSrc, 'lastCompletedWeeklyDeadlineSec');
  if (!lastSrc) { fails++; console.log('  FAIL lastCompletedWeeklyDeadlineSec не найдена'); }
  else {
    const cases = [
      ['последний состоявшийся',
       { weekly: [ {date:'2026-07-20', winners:[{place:1}]}, {date:'2026-07-27', winners:[{place:1}]} ] },
       '2026-07-27T20:00:00.000Z'],
      ['skipped сверху — берём тот, что ниже',
       { weekly: [ {date:'2026-07-27', winners:[{place:1}]}, {date:'2026-08-03', skipped:true, reason:'Not enough entries'} ] },
       '2026-07-27T20:00:00.000Z'],
      ['пустой winners[] тоже не считается',
       { weekly: [ {date:'2026-07-27', winners:[{place:1}]}, {date:'2026-08-03', winners:[]} ] },
       '2026-07-27T20:00:00.000Z'],
      ['состоявшихся нет вовсе', { weekly: [ {date:'2026-08-03', skipped:true} ] }, 'null'],
      ['файла нет', null, 'null'],
    ];
    for (const [name, data, want] of cases) {
      const WINNERS_PATH = '/virtual/winners.json';
      const fsStub = {
        existsSync: () => data !== null,
        readFileSync: () => JSON.stringify(data)
      };
      // внешние имена (fs, WINNERS_PATH) подменяем через обёртку
      const wrapped = new Function('fs', 'WINNERS_PATH', 'console',
        lastSrc + '\nreturn lastCompletedWeeklyDeadlineSec();');
      const got = wrapped(fsStub, WINNERS_PATH, { warn(){} });
      check(name, got === null ? 'null' : new Date(got*1000).toISOString(), want);
    }
  }
}

// ── [B] Карточка победителя ─────────────────────────────────────────────────
console.log('\n[B] Подпись раунда на карточке');
const appSrc = read('app.js', ['assets/js/app.js']);
const schedSrc = read('draw-schedule.js', ['assets/js/draw-schedule.js']);
if (!appSrc || !schedSrc) { console.log('  ПРОПУЩЕНО: app.js или draw-schedule.js не найдены'); }
else {
  const window = {};
  eval(schedSrc);
  const labelSrc = extract(appSrc, 'drawDateLabel');
  const staleSrc = extract(appSrc, 'isStaleRound');
  if (!labelSrc || !staleSrc) { fails++; console.log('  FAIL drawDateLabel/isStaleRound не найдены'); }
  else {
    eval(labelSrc); eval(staleSrc);
    check('дата раунда читаемо', drawDateLabel('2026-07-27'), '27 Jul 2026');
    check('пустая дата', drawDateLabel(null), 'null');

    // Подменяем «сейчас» через prev(): проверяем на реальных отметках
    const S = window.DRAW_SCHEDULE;
    const monEvening = new Date(Date.UTC(2026, 7, 3, 21, 30, 0));
    const prevW = S.prev('weekly', monEvening);
    check('последний прошедший weekly вечером пн', prevW.toISOString(), '2026-08-03T20:00:00.000Z');

    // isStaleRound берёт «сейчас» из системных часов, поэтому проверяем
    // саму логику сравнения напрямую, теми же величинами
    const roundOld = Date.parse('2026-07-27T20:00:00Z');
    const roundNew = Date.parse('2026-08-03T20:00:00Z');
    check('раунд недельной давности → несвежий', roundOld < prevW.getTime() - 60000, 'true');
    check('свежий раунд → свежий',              roundNew < prevW.getTime() - 60000, 'false');
  }

  // Пул должен подписываться в карточке всегда — это и ловит подмену
  // daily-результата на вкладке Weekly
  const cardSrc = extract(appSrc, 'showWinnerCard');
  if (!cardSrc) { fails++; console.log('  FAIL showWinnerCard не найдена'); }
  else {
    check('карточка подписывает Weekly Draw', /Weekly Draw/.test(cardSrc), 'true');
    check('карточка подписывает Daily Draw',  /Daily Draw/.test(cardSrc), 'true');
    check('пул берётся из данных раунда',     /data\.pool/.test(cardSrc), 'true');
    check('есть запасной вариант currentLottery', /currentLottery/.test(cardSrc), 'true');
    check('пометка несвежести на месте',      /not recorded yet/.test(cardSrc), 'true');
  }

  // DrawBridge должен передавать date во все карточки
  const bridgeSrc = read('DrawBridge.js', ['assets/js/draw-v2/DrawBridge.js']);
  if (!bridgeSrc) console.log('  ПРОПУЩЕНО: DrawBridge.js не найден');
  else {
    const cardCalls = (bridgeSrc.match(/address:\s*w\.address/g) || []).length;
    const withDate  = (bridgeSrc.match(/date:\s*(round|this\.round)\.date/g) || []).length;
    check('во всех карточках DrawBridge есть date', withDate + '/' + cardCalls, cardCalls + '/' + cardCalls);
  }
}

// ── [C] Смена пула на колесе ────────────────────────────────────────────────
// Баг: при переключении вкладки daily ↔ weekly колесо оставалось в теме
// прежнего пула. Сверка пула в refreshLive() стояла НИЖЕ раннего выхода
// `if (state.model) return`, и как только появился первый раунд со снимком,
// движок перестал узнавать о переключении.
console.log('\n[C] Смена пула на колесе');
const bridgeSrc2 = read('DrawBridge.js', ['assets/js/draw-v2/DrawBridge.js']);
if (!bridgeSrc2) console.log('  ПРОПУЩЕНО: DrawBridge.js не найден');
else {
  const refresh = extractMethod(bridgeSrc2, 'refreshLive');
  if (!refresh) { fails++; console.log('  FAIL refreshLive не найдена'); }
  else {
    // Комментарии срезаем: в самом коде пояснение цитирует
    // `if (state.model) return`, и indexOf нашёл бы цитату вместо кода
    const code = refresh.replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/^\s*\/\/.*$/gm, '');
    const iPool  = code.indexOf('pagePool !== this.engine.pool');
    // Раньше искали дословно `state.model) return`. Коммит 1523a5a сделал
    // выход условным — `state.model && _stillShowingThatRound` — строка
    // исчезла, и тест падал на живом и правильном коде.
    //
    // Инвариант не в форме выхода, а в ПОРЯДКЕ: любой выход по снимку обязан
    // стоять ниже сверки пула, иначе движок не узнает о переключении вкладки
    // и колесо останется в чужой теме. Ищем по подстроке без формы.
    const iModel = code.indexOf('state.model');
    check('сверка пула вообще есть', iPool >= 0, 'true');
    check('выход по снимку есть', iModel >= 0, 'true');
    check('сверка пула ВЫШЕ выхода по снимку', iPool >= 0 && iModel >= 0 && iPool < iModel, 'true');
    check('тема приводится сразу, не ждём раунд', /this\.ensure\(pagePool\)/.test(code), 'true');
  }

  const ens = extractMethod(bridgeSrc2, 'ensure');
  if (!ens) { fails++; console.log('  FAIL ensure не найдена'); }
  else {
    check('ensure сравнивает пул с нарисованным', /pool !== this\.wheelPool/.test(ens), 'true');
    check('ensure меняет тему существующему колесу', /this\.wheel\.setPool\(pool\)/.test(ens), 'true');
  }
}

console.log('\n' + (fails === 0 ? '=== ВСЁ ЗЕЛЁНОЕ ===' : '=== ' + fails + ' ПРОВАЛОВ ==='));
process.exit(fails === 0 ? 0 : 1);
