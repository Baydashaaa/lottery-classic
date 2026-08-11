// Тот же расчёт, что делает скрипт розыгрыша, но вызванный отдельно.
// Если он расходится с winners.json — правило разъехалось, и в браузер
// его нести нельзя.
import fs from 'fs';
import { computeWinner } from '../chain-tickets.js';

const all = JSON.parse(fs.readFileSync('winners.json', 'utf8')).daily;
const done = all.filter(x => x.skipped !== true);
const w = done[done.length - 1];

const deadlineMs = Date.parse(w.date + 'T20:00:00Z');
// Граница берётся так же, как в lottery-draw.js: дедлайн предыдущего
// состоявшегося розыгрыша.
const prev = done[done.length - 2];
const boundaryTs = prev ? Math.floor(Date.parse(prev.date + 'T20:00:00Z') / 1000) : undefined;

const r = await computeWinner({ pool: 'daily', deadlineMs, boundaryTs });

console.log('раунд     ', w.date, '| граница', prev ? prev.date : '(нет)');
console.log('в записи  ', w.winner, '| index', w.winner_index, '| entries', w.entries);
console.log('посчитано ', r.winner, '| index', r.index, '| entries', r.tickets.length);
console.log('блок      ', r.block.height, r.block.hash === w.block_hash ? 'хеш совпал' : 'ХЕШ РАЗОШЁЛСЯ');
console.log(r.winner === w.winner && r.index === w.winner_index ? 'СОВПАЛО' : 'РАСХОЖДЕНИЕ');
