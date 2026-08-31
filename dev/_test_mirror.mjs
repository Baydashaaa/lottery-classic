// Проверка чистых функций pool-mirror.js на синтетическом ответе контракта.
// Запуск: node dev/_test_mirror.mjs  (из корня репо)
import assert from 'assert';
import {
  tsToIso, roundKey, tierOf, buildTickets, packTickets, bps, toLunc,
  buildRecord, buildSnapshot,
} from '../.github/scripts/pool-mirror.js';

const close = '1788292800000000000';           // 2026-09-01T20:00:00Z
assert.equal(tsToIso(close), '2026-09-01T20:00:00.000Z');
assert.equal(roundKey('daily', close), 'daily_2026-09-01');
assert.equal(tierOf('common-33'), 'common');
assert.equal(tierOf('legendary-2'), 'legendary');
assert.equal(tierOf('weird'), null);

const A = 'terra1aaa', B = 'terra1bbb', C = 'terra1ccc';
const entries = [
  { entry_id: 1, entry: { token_id: 'common-1', minter: A, entries: 1, amount: '25000000000' } },
  { entry_id: 2, entry: { token_id: 'rare-2', minter: B, entries: 5, amount: '125000000000' } },
  { entry_id: 3, entry: { token_id: 'common-3', minter: A, entries: 1, amount: '25000000000' } },
  { entry_id: 4, entry: { token_id: 'common-4', minter: C, entries: 1, amount: '25000000000' } },
];
const { flat, meta } = buildTickets(entries);
assert.equal(flat.length, 8);
assert.deepEqual(flat.slice(0, 3), [A, B, B]);
assert.equal(flat[6], A);   // третий вход идёт после пяти билетов rare
assert.equal(flat[7], C);
assert.equal(meta[B].tier, 'rare');
assert.equal(meta[A].tokenId, 'common-1');  // берётся первый токен кошелька

const packed = packTickets(flat, meta);
assert.deepEqual(packed.map((p) => [p[0], p[1]]), [[A, 1], [B, 5], [A, 1], [C, 1]]);
assert.equal(packed.reduce((s, p) => s + p[1], 0), flat.length);

assert.equal(bps('200000000000', 8000).toString(), '160000000000');
assert.equal(toLunc('160000000000'), 160000);

// ── daily: один победитель ──────────────────────────────────────────────────
const cfgDaily = {
  nft_contract: 'terra1nft', payout_bps: [8000], treasury_bps: 1000, caller_bps: 10,
};
const roundDaily = {
  round_id: 23, close_time: close, status: 'drawn', total_entries: 8,
  winner_indexes: [6], winners: [A], pot: '200000000000',
  seed_hash: 'sh', secret: 'sc', entropy: 'en', result: 're',
  settled_at: '1788292805000000000', has_late_entries: false,
};
const recD = buildRecord({ pool: 'daily', round: roundDaily, proof: {}, cfg: cfgDaily, txHash: 'TX1', flat, meta });
assert.equal(recD.winner, A);                    // минтер по индексу 6
assert.equal(recD.winner_index, 6);
assert.equal(recD.prize_lunc, 160000);
assert.equal(recD.participants, 3);
assert.equal(recD.round_id, 'daily_2026-09-01');
assert.equal(recD.contract_round_id, 23);
assert.ok(!('paid_to' in recD));                 // владелец совпал с минтером

// токен передали: приз ушёл другому, билет всё равно принадлежит минтеру
const recMoved = buildRecord({
  pool: 'daily', round: { ...roundDaily, winners: ['terra1new'] },
  proof: {}, cfg: cfgDaily, txHash: 'TX1', flat, meta,
});
assert.equal(recMoved.winner, A);
assert.equal(recMoved.paid_to, 'terra1new');

// ── weekly: три места ───────────────────────────────────────────────────────
const cfgWeekly = { ...cfgDaily, payout_bps: [4800, 2000, 1200] };
const roundWeekly = { ...roundDaily, round_id: 4, winner_indexes: [1, 6, 7], winners: [B, A, C] };
const recW = buildRecord({ pool: 'weekly', round: roundWeekly, proof: {}, cfg: cfgWeekly, txHash: 'TX2', flat, meta });
assert.equal(recW.winners.length, 3);
assert.deepEqual(recW.winners.map((w) => w.address), [B, A, C]);
assert.deepEqual(recW.winners.map((w) => w.amount_lunc), [96000, 40000, 24000]);
assert.equal(recW.treasury_lunc, 20000);
assert.ok(!('winner' in recW));

// ── пропущенный раунд ───────────────────────────────────────────────────────
const recS = buildRecord({
  pool: 'daily', round: { ...roundDaily, status: 'skipped', winner_indexes: [], winners: [], pot: '0' },
  proof: {}, cfg: cfgDaily, txHash: null, flat: [], meta: {},
});
assert.equal(recS.skipped, true);
assert.ok(recS.reason.includes('skipped'));

// ── снимок ──────────────────────────────────────────────────────────────────
const snapD = buildSnapshot({ pool: 'daily', record: recD, round: roundDaily, flat, meta });
assert.equal(snapD.total, 8);
assert.equal(snapD.wallets, 3);
assert.equal(snapD.winner_index, 6);
assert.equal(snapD.round_id, 'daily_2026-09-01');

// главный инвариант фронта: tickets[winner_index] == winner
const expand = (pairs) => pairs.flatMap(([a, n]) => Array(n).fill(a));
assert.equal(expand(snapD.tickets)[snapD.winner_index], recD.winner);

const snapW = buildSnapshot({ pool: 'weekly', record: recW, round: roundWeekly, flat, meta });
assert.deepEqual(snapW.winner_index, [1, 6, 7]);
snapW.winner_index.forEach((idx, i) => {
  assert.equal(expand(snapW.tickets)[idx], recW.winners[i].address);
});

console.log('_test_mirror: все проверки пройдены');
