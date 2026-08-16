// Локальный снимок против опубликованного. Если они разойдутся, колесо
// нарисует одни сектора, а потом перескочит на другие - хуже, чем ждать.
import fs from 'fs';
import { buildLocalSnapshot } from '../chain-tickets.js';

const all = JSON.parse(fs.readFileSync('winners.json', 'utf8')).daily;
const done = all.filter(x => x.skipped !== true);
const w = done[done.length - 1];
const prev = done[done.length - 2];

const r = await buildLocalSnapshot({
  pool: 'daily',
  deadlineMs: Date.parse(w.date + 'T20:00:00Z'),
  roundId: w.round_id,
  boundaryTs: prev ? Math.floor(Date.parse(prev.date + 'T20:00:00Z') / 1000) : undefined,
});

const pub = JSON.parse(fs.readFileSync(`rounds/${w.round_id}.json`, 'utf8'));
const keys = ['round_id', 'pool', 'total', 'wallets', 'block_hash', 'block_height', 'winner_index'];
let bad = 0;
for (const k of keys) {
  const same = JSON.stringify(r.snapshot[k]) === JSON.stringify(pub[k]);
  if (!same) bad++;
  console.log(`${same ? 'ok  ' : 'РАЗН'} ${k}: локально ${JSON.stringify(r.snapshot[k])} / опубликовано ${JSON.stringify(pub[k])}`);
}
const t1 = JSON.stringify(r.snapshot.tickets), t2 = JSON.stringify(pub.tickets);
console.log(t1 === t2 ? 'ok   tickets совпали' : 'РАЗН tickets:\n  ' + t1 + '\n  ' + t2);
if (t1 !== t2) bad++;
console.log(bad ? `\n${bad} расхождений` : '\nвсё совпало');
