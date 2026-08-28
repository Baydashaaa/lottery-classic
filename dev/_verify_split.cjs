#!/usr/bin/env node
// Проверка нарезки app.js. Запускать из корня репо: node dev/_verify_split.js
//
// Склеивает куски в порядке списка ORDER и сравнивает с assets/js/app.js.
// Пустой результат = куски побайтово равны исходнику, поведение не изменилось.
//
// ORDER ниже - тот же порядок, что в тегах <script> в index.html.
// Менять его нельзя: в коде есть операторы верхнего уровня и объявления
// const/let, порядок повторяет исходный файл строка в строку.
//
// Скрипт нужен ТОЛЬКО на время переезда. Как только начнёшь править куски
// по отдельности, расхождение станет нормой - тогда удали и этот скрипт,
// и старый assets/js/app.js.

const fs = require('fs');
const path = require('path');

const ORDER = [
  'config.js',
  'chain.js',
  'pool-timer.js',
  'modal.js',
  'buy.js',
  'data.js',
  'wheel-legacy.js',
  'verify.js',
  'admin.js',
  'wallet.js',
  'init.js',
  'winners-v2.js',
  'verify-v2.js',
  'winners-v3.js',
];

const DIR = path.join(__dirname, '..', 'assets', 'js', 'app');
const ORIG = path.join(__dirname, '..', 'assets', 'js', 'app.js');

// на диске не должно быть кусков, которых нет в ORDER, и наоборот
const onDisk = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
const extra = onDisk.filter(f => !ORDER.includes(f));
const missing = ORDER.filter(f => !onDisk.includes(f));
if (extra.length)   console.log('ЛИШНИЕ файлы (нет в ORDER):', extra.join(', '));
if (missing.length) console.log('НЕ ХВАТАЕТ файлов:', missing.join(', '));
if (extra.length || missing.length) process.exit(1);

ORDER.forEach(f => {
  const t = fs.readFileSync(path.join(DIR, f), 'utf8');
  console.log(`  ${f.padEnd(18)} ${String(t.split('\n').length).padStart(5)} строк`);
});

if (!fs.existsSync(ORIG)) {
  console.log('\nassets/js/app.js уже удалён - сверять не с чем. Можно удалить и этот скрипт.');
  process.exit(0);
}

const merged = ORDER.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
const orig = fs.readFileSync(ORIG, 'utf8');

if (merged === orig) {
  console.log('\nOK: склейка побайтово равна assets/js/app.js');
  process.exit(0);
}

console.log('\nРАСХОЖДЕНИЕ');
console.log(`  склейка:  ${merged.length} байт, ${merged.split('\n').length} строк`);
console.log(`  оригинал: ${orig.length} байт, ${orig.split('\n').length} строк`);

const a = merged.split('\n'), b = orig.split('\n');
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    console.log(`  первая разошедшаяся строка: ${i + 1}`);
    console.log(`    склейка:  ${JSON.stringify((a[i] || '').slice(0, 90))}`);
    console.log(`    оригинал: ${JSON.stringify((b[i] || '').slice(0, 90))}`);
    break;
  }
}
process.exit(1);
