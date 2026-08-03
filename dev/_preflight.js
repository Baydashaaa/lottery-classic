/**
 * dev/_preflight.js — предполётная проверка скриптов розыгрыша.
 *
 * Зачем: 2 и 3 августа 2026 розыгрыши не состоялись, потому что в
 * lottery-draw.js оказался `require('./round-snapshot')`, а package.json
 * содержит "type": "module". `node --check` такое НЕ ловит — синтаксис
 * валиден, падает только загрузка модуля, то есть в 20:00 на раннере.
 * Узнали об этом через двое суток.
 *
 * Проверка делает три вещи:
 *   1. система модулей: при "type":"module" никаких require()/module.exports
 *   2. относительные импорты: файл существует и расширение указано явно
 *   3. РЕАЛЬНАЯ загрузка: модули импортируются по-настоящему. lottery-draw.js
 *      грузится копией, в которой вызов main() вырезан, — так проверяется
 *      весь граф импортов, но розыгрыш не запускается
 *
 * Запуск: node dev/_preflight.js   (из корня репо)
 * Ставится шагом в CI на push — тогда поломка видна при коммите, а не вечером.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = fs.existsSync(path.join(process.cwd(), 'package.json'))
  ? process.cwd()
  : path.join(process.cwd(), '..');

let fails = 0;
const ok   = (m) => console.log('  ok   ' + m);
const bad  = (m) => { fails++; console.log('  FAIL ' + m); };

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const isESM = pkg.type === 'module';
console.log('package.json: "type": ' + JSON.stringify(pkg.type || 'commonjs') +
            '  → репо ' + (isESM ? 'ESM' : 'CommonJS'));

// Скрипты, которые запускает GitHub Actions. Добавляй сюда новые.
const SCRIPTS = [
  'lottery-draw.js',
  'round-snapshot.js',
  '.github/scripts/update-free-entries.js'
].filter(f => fs.existsSync(path.join(ROOT, f)));

/** Грубо срезать комментарии, чтобы не ловить слова из пояснений */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

console.log('\n[1] Система модулей');
for (const rel of SCRIPTS) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const problems = [];
  if (isESM) {
    if (/\brequire\s*\(/.test(src))     problems.push('require(');
    if (/\bmodule\.exports\b/.test(src)) problems.push('module.exports');
    if (/\b__dirname\b/.test(src))       problems.push('__dirname (в ESM не определён)');
    if (/\b__filename\b/.test(src))      problems.push('__filename (в ESM не определён)');
  } else {
    if (/^\s*import\s.+\sfrom\s/m.test(src)) problems.push('import ... from');
    if (/^\s*export\s/m.test(src))            problems.push('export');
  }
  problems.length ? bad(rel + ' — ' + problems.join(', ')) : ok(rel);
}

console.log('\n[2] Относительные импорты разрешаются');
for (const rel of SCRIPTS) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const dir = path.dirname(path.join(ROOT, rel));
  const specs = [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => m[1]);
  if (!specs.length) { ok(rel + ' — относительных импортов нет'); continue; }
  for (const spec of specs) {
    const target = path.resolve(dir, spec);
    if (!path.extname(spec)) {
      bad(rel + ' → ' + spec + ' — в ESM расширение обязательно (.js)');
    } else if (!fs.existsSync(target)) {
      bad(rel + ' → ' + spec + ' — файла нет: ' + target);
    } else {
      ok(rel + ' → ' + spec);
    }
  }
}

console.log('\n[3] Модули реально загружаются');
// round-snapshot.js без побочных эффектов — грузим как есть
try {
  const mod = await import(pathToFileURL(path.join(ROOT, 'round-snapshot.js')).href);
  if (typeof mod.writeRoundSnapshot !== 'function') {
    bad('round-snapshot.js — writeRoundSnapshot не экспортирован');
  } else {
    ok('round-snapshot.js загружен, writeRoundSnapshot на месте');
  }
} catch (e) {
  bad('round-snapshot.js — ' + e.message);
}

// lottery-draw.js вызывает main() на верхнем уровне. Грузим копию без вызова:
// граф импортов проверяется целиком, розыгрыш не стартует.
const LD = path.join(ROOT, 'lottery-draw.js');
if (fs.existsSync(LD)) {
  const tmp = path.join(ROOT, '.preflight-lottery-draw.mjs');
  try {
    let src = fs.readFileSync(LD, 'utf8');
    const before = src;
    src = src.replace(/^\s*main\(\)[\s\S]*$/m,
      '// PREFLIGHT: вызов main() вырезан — проверяем только загрузку модуля\n');
    if (src === before) {
      bad('lottery-draw.js — не нашёл вызов main(), проверку загрузки пропускаю');
    } else {
      fs.writeFileSync(tmp, src);
      await import(pathToFileURL(tmp).href);
      ok('lottery-draw.js загружается (main() не вызывался)');
    }
  } catch (e) {
    bad('lottery-draw.js — ' + e.message);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

console.log('\n' + (fails === 0
  ? '=== ПРЕДПОЛЁТНАЯ ПРОВЕРКА ПРОЙДЕНА ==='
  : '=== ' + fails + ' ПРОБЛЕМ — розыгрыш в таком виде упадёт ==='));
process.exit(fails === 0 ? 0 : 1);
