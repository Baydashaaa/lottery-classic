// lottery-draw.js
// Runs via GitHub Actions at 20:00 UTC daily/weekly
//
// Winner selection: winner_index = block_hash % total_tickets
// The block is NOT "whatever is latest when the script runs" — it is the first
// block at or after the round deadline (the most recent 20:00 UTC). That makes
// the outcome independent of WHEN the draw is triggered, so re-running the
// workflow can no longer change the winner. See getRoundBlockInfo().
//
// Anyone can verify a past draw from winners.json alone:
//   1. take block_height, fetch that block from any Terra Classic LCD;
//   2. its block_id.hash (base64 → hex, uppercase) must equal block_hash;
//   3. BigInt("0x" + block_hash) % entries must equal winner_index;
//   4. the ticket list is rebuilt from the worker: /round-stats returns mints
//      ordered by usedAt; each wallet repeats `entries` times, in that order.
//
// Source of participants (NEW): Cloudflare Worker /round-stats?pool=daily|weekly
// After successful draw: POST /round-complete → marks activations consumed

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { SigningStargateClient }    from '@cosmjs/stargate';
import crypto from 'crypto';
import fs     from 'fs';
import path   from 'path';
// Снимок билетов раунда. ВАЖНО: package.json содержит "type": "module",
// весь репо — ESM. Здесь обязан быть import с ЯВНЫМ расширением .js;
// require() падает с ReferenceError и роняет розыгрыш целиком
// (так пропали daily 2026-08-02 и weekly 2026-08-03).
import { writeRoundSnapshot } from './round-snapshot.js';

import { buildTicketsFromChain } from './chain-tickets.js';
// ── Constants ────────────────────────────────────────────────────────────────
const DRAW_TYPE       = process.env.DRAW_TYPE || 'daily';
const IS_DAILY        = DRAW_TYPE === 'daily';
const CHAIN_ID        = 'columbus-5';
const DENOM           = 'uluna';

const DAILY_WALLET    = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET   = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';
const TREASURY_WALLET = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';

const DRAW_WALLET     = IS_DAILY ? DAILY_WALLET   : WEEKLY_WALLET;
const MNEMONIC        = IS_DAILY
  ? process.env.OPERATOR_MNEMONIC_DAILY
  : process.env.OPERATOR_MNEMONIC_WEEKLY;

// Worker integration
const DRAW_WORKER_URL     = process.env.DRAW_WORKER_URL     || 'https://oracle-draw.vladislav-baydan.workers.dev';
const DISTRIBUTION_SECRET = process.env.DISTRIBUTION_SECRET || '';

// Prize split
const DAILY_SPLIT = { winner: 0.80, seeds: 0.10, treasury: 0.10 };
const WEEKLY_SPLIT = [
  { share: 0.48, label: '1st' },
  { share: 0.20, label: '2nd' },
  { share: 0.12, label: '3rd' },
];
const WEEKLY_SEEDS    = 0.10;
const WEEKLY_TREASURY = 0.10;

const MIN_ENTRIES  = 5;           // minimum to hold daily draw
const WEEKLY_MIN_LUNC = 500000;   // minimum pool balance (LUNC) to hold weekly draw

const RPC_NODES = [
  'https://terra-classic-rpc.publicnode.com',
  'https://rpc.terra-classic.hexxagon.io',
];

const LCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd.terraclassic.community',
  'https://terra-classic-lcd.hexxagon.io',
];


const WINNERS_PATH       = path.resolve('winners.json');
const FREE_ENTRIES_PATH  = path.resolve('free-entries.json');

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) { return Math.floor(n).toLocaleString(); }

// ── Fetch participants from Worker /round-stats ──────────────────────────────
// Returns { "terra1abc": entriesCount, ... }
async function fetchParticipants(pool) {
  const url = DRAW_WORKER_URL + '/round-stats?pool=' + pool;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    throw new Error('Worker /round-stats returned HTTP ' + res.status);
  }
  const data = await res.json();
  return data.byWallet || {};
}

// ── Mark activations as consumed after successful draw ──────────────────────
async function markRoundComplete(pool, roundId, winnerWallet, drawTxHash, winnersArr) {
  if (!DISTRIBUTION_SECRET) {
    console.warn('DISTRIBUTION_SECRET not set — skipping /round-complete. Activations will NOT be consumed!');
    return;
  }
  try {
    const res = await fetch(DRAW_WORKER_URL + '/round-complete', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + DISTRIBUTION_SECRET,
      },
      body: JSON.stringify({ pool, roundId, winnerWallet, drawTxHash, winners: Array.isArray(winnersArr) && winnersArr.length ? winnersArr : undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('/round-complete returned HTTP ' + res.status + ':', body.error || body);
      return;
    }
    console.log('/round-complete OK — consumed ' + (body.consumedCount || 0) + ' activations');
  } catch(e) {
    console.warn('/round-complete request failed:', e.message);
  }
}

// Get current round id (matches Worker's getCurrentRoundId logic)
function getCurrentRoundId(pool) {
  const now = new Date();
  if (pool === 'daily') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
    if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 1);
    return 'daily_' + d.toISOString().slice(0, 10);
  }
  if (pool === 'weekly') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
    const dayOfWeek = d.getUTCDay();
    const diffToMon = (dayOfWeek + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diffToMon);
    if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 7);
    return 'weekly_' + d.toISOString().slice(0, 10);
  }
  return pool + '_unknown';
}

// ── Add free entries for Weekly Draw ────────────────────────────────────────
function addFreeEntries(participants) {
  if (!fs.existsSync(FREE_ENTRIES_PATH)) return participants;
  try {
    const data = JSON.parse(fs.readFileSync(FREE_ENTRIES_PATH, 'utf8'));
    const entries = data.entries || {};
    for (const [wallet, info] of Object.entries(entries)) {
      const total = info.total || 0;
      if (total > 0) {
        participants[wallet] = (participants[wallet] || 0) + total;
      }
    }
  } catch (e) {
    console.warn('Could not load free-entries.json:', e.message);
  }
  return participants;
}

// Граница «отыграно» для weekly.
//
// Берётся из последней НЕпропущенной weekly-записи: её дедлайн и есть момент,
// до которого все NFT этого пула уже сыграли. Вычислить её из цепи нельзя —
// раунд мог состояться за счёт бесплатных входов, которых в цепи нет, или
// сорваться из-за баланса пула ниже WEEKLY_MIN_LUNC.
//
// Значит weekly проверяем не полностью: NFT-часть списка любой пересоберёт по
// цепи, а вот эта граница берётся из winners.json, то есть из файла, который
// ведём мы. Проверить его можно по истории коммитов — слабее цепи, но это
// настоящий предел, а не наша небрежность.
// Для daily — то же самое, и по той же причине, что стала видна 6 августа:
// расписание говорит, когда розыгрыш ДОЛЖЕН был случиться, а не случился ли он.
// В тот день Actions лежали, розыгрыш не прошёл, но правило по расписанию уже
// считало пять NFT отыгранными — они бы молча пропали.
function lastDailyBoundaryTs() {
  return lastBoundaryTs('daily');
}

function lastWeeklyBoundaryTs() {
  return lastBoundaryTs('weekly');
}

function lastBoundaryTs(pool) {
  const winners = loadWinners();
  const done = (winners[pool] || []).filter(function (w) { return !w.skipped; });
  if (done.length === 0) return null;

  const last = done[done.length - 1];
  // Новые записи несут deadline явно; старые — только дату, а weekly всегда
  // закрывается в понедельник в 20:00 UTC.
  const iso = last.deadline ||
    ((last.date || String(last.round_id || '').replace(pool + '_', '')) + 'T20:00:00Z');
  const ts = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(ts)) {
    console.warn('Could not read the '+pool+' boundary from winners.json: ' + iso);
    return null;
  }
  return ts;
}

// Бесплатные входы как упорядоченный список билетов.
// Порядок — по адресу кошелька, а не по порядку ключей в JSON: только так
// проверяющий соберёт тот же массив, что и мы.
function buildFreeTickets() {
  if (!fs.existsSync(FREE_ENTRIES_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FREE_ENTRIES_PATH, 'utf8'));
    const entries = data.entries || {};
    const out = [];
    for (const wallet of Object.keys(entries).sort()) {
      const total = (entries[wallet] && entries[wallet].total) || 0;
      for (let i = 0; i < total; i++) out.push(wallet);
    }
    return out;
  } catch (e) {
    console.warn('Could not load free-entries.json:', e.message);
    return [];
  }
}

// ── Build ticket array ───────────────────────────────────────────────────────
// [ "terra1abc", "terra1abc", "terra1xyz", ... ]
function buildTickets(participants) {
  const tickets = [];
  for (const [addr, count] of Object.entries(participants)) {
    for (let i = 0; i < count; i++) tickets.push(addr);
  }
  return tickets;
}

// ── Выбор победителя по хешу блока ───────────────────────────────────────────
// winner_index = BigInt(block_hash_hex) % BigInt(total_tickets)
//
// ВАЖНО про грайндинг. Раньше брался хеш ПОСЛЕДНЕГО блока на момент запуска.
// Это делало результат зависимым от времени запуска: оператор мог прогнать
// розыгрыш, посмотреть победителя и, если не понравилось, перезапустить через
// минуту — уже с другим хешем. Бесплатно и без следов в самом winners.json.
//
// Теперь высота блока предопределена: берётся ПЕРВЫЙ блок, чей timestamp
// не раньше дедлайна раунда (ближайшие прошедшие 20:00 UTC). Дедлайн одинаков
// для всех запусков внутри окна, поэтому сколько бы раз розыгрыш ни запускали,
// блок будет тот же и победитель тот же. Перезапуск больше ничего не меняет.
//
// Побочный плюс: участник может проверить розыгрыш сам, зная только round_id —
// дедлайн из него вычисляется, блок находится однозначно.
function getDrawDeadlineTs() {
  // Только для холостых прогонов: боевой путь никогда сюда не заходит,
  // потому что DRY_RUN запрещает любую отправку средств.
  if (process.env.DRY_RUN === '1' && process.env.DRY_RUN_DEADLINE) {
    const forced = new Date(process.env.DRY_RUN_DEADLINE).getTime();
    if (!Number.isFinite(forced)) throw new Error('DRY_RUN_DEADLINE is not a valid date');
    console.warn('DRY_RUN: deadline forced to ' + new Date(forced).toISOString());
    return forced;
  }
  // The job is scheduled at 19:30 so GitHub's start delay is absorbed by
  // waiting rather than added to the result. That means "now" is normally
  // BEFORE the deadline, and taking the last one that passed would re-run
  // yesterday's round — which is exactly what happened on 2026-08-08.
  const EARLY_START_WINDOW_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0
  ));
  if (now.getTime() < d.getTime()) {
    // Close enough to be an early start for today's draw; otherwise this is a
    // late run and the round it belongs to is the one already closed.
    if (d.getTime() - now.getTime() > EARLY_START_WINDOW_MS) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
  }
  return d.getTime();
}

async function fetchBlock(heightOrLatest) {
  const suffix = heightOrLatest === 'latest' ? 'latest' : String(heightOrLatest);
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(base + '/cosmos/base/tendermint/v1beta1/blocks/' + suffix, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const hashRaw = data && data.block_id && data.block_id.hash;
      const header  = data && data.block && data.block.header;
      if (!hashRaw || !header) continue;
      return {
        hash:   Buffer.from(hashRaw, 'base64').toString('hex').toUpperCase(),
        height: Number(header.height),
        timeMs: new Date(header.time).getTime(),
      };
    } catch (e) {
      console.warn('Block fetch failed from ' + base + ': ' + e.message);
    }
  }
  return null;
}

// Первый блок с timestamp >= targetMs. Высота и время растут монотонно,
// поэтому бинарный поиск сходится за ~15 запросов.
async function findBlockAtOrAfter(targetMs) {
  const latest = await fetchBlock('latest');
  if (!latest) return null;
  if (latest.timeMs < targetMs) {
    console.warn('Latest block is older than the round deadline — too early to draw');
    return null;
  }

  const AVG_BLOCK_MS = 6000;
  const span = Math.ceil((latest.timeMs - targetMs) / AVG_BLOCK_MS * 2) + 100;
  let lo = Math.max(1, latest.height - span);
  let hi = latest.height;

  const loBlock = await fetchBlock(lo);
  if (!loBlock) return null;
  if (loBlock.timeMs >= targetMs) return loBlock;   // нижняя граница уже за дедлайном

  let best = latest;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await fetchBlock(mid);
    if (!b) return null;
    if (b.timeMs >= targetMs) { best = b; hi = b.height; }
    else { lo = b.height; }
  }
  return best;
}

// Возвращает { hash, height, timeMs } блока дедлайна.
// Фолбэка на sha256(Date.now()) больше НЕТ: такая случайность непроверяема,
// а в winners.json отличалась бы только block_height: null. Если блок
// недоступен — розыгрыш не проводится, активации переходят в следующий раунд.
// Ждём дедлайн, а не отказываемся из-за него.
//
// Джоб запускается заранее (cron 19:30), потому что GitHub стартует когда
// захочет — наблюдались задержки до 40 минут. Раньше эта задержка целиком
// прибавлялась к времени публикации результата; теперь она съедается
// ожиданием, и розыгрыш происходит через секунды после 20:00.
//
// Ждём по времени цепи, а не по часам раннера: дедлайн определён в терминах
// блоков, и только это время имеет значение.
async function waitForDeadline(deadlineMs, maxWaitMs) {
  const started = Date.now();
  for (;;) {
    const latest = await fetchBlock('latest');
    if (latest && latest.timeMs >= deadlineMs) {
      console.log('Deadline reached, chain time ' + new Date(latest.timeMs).toISOString());
      return true;
    }
    if (Date.now() - started > maxWaitMs) {
      console.warn('Waited ' + Math.round(maxWaitMs / 60000) + 'm and the deadline is still ahead — giving up');
      return false;
    }
    const left = latest ? Math.round((deadlineMs - latest.timeMs) / 1000) : '?';
    console.log('Waiting for the deadline, ' + left + 's to go...');
    await new Promise(r => setTimeout(r, 10000));
  }
}

async function getRoundBlockInfo() {
  const deadline = getDrawDeadlineTs();
  console.log('Round deadline (UTC): ' + new Date(deadline).toISOString());
  // До 45 минут — с запасом на самый поздний старт, что мы видели.
  await waitForDeadline(deadline, 45 * 60 * 1000);
  const b = await findBlockAtOrAfter(deadline);
  if (!b) {
    throw new Error(
      'Could not resolve the deadline block — draw aborted. ' +
      'Using any other randomness source would make the result unverifiable. ' +
      'Activations roll over; re-run once the LCD nodes respond.'
    );
  }
  console.log('Deadline block: height ' + b.height + ', time ' + new Date(b.timeMs).toISOString());
  console.log('Block hash: ' + b.hash);
  return { hash: b.hash, height: String(b.height), timeMs: b.timeMs };
}

function selectWinner(tickets, blockHash) {
  const total = BigInt(tickets.length);
  const hashBig = BigInt('0x' + blockHash.replace(/[^0-9a-fA-F]/g, '').slice(0, 64));
  const idx = Number(hashBig % total);
  return { winner: tickets[idx], index: idx, blockHash };
}

// ── Get wallet balance ───────────────────────────────────────────────────────
async function getBalance(address) {
  // Use LCD nodes — more reliable and real-time than FCD
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(`${base}/cosmos/bank/v1beta1/balances/${address}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const balances = data.balances || [];
      const luna = balances.find(function(b) { return b.denom === DENOM; });
      const bal = luna ? Number(luna.amount) : 0;
      console.log('Balance from ' + base + ': ' + fmt(bal / 1e6) + ' LUNC');
      return bal;
    } catch (e) {
      console.warn('Balance fetch failed from ' + base + ':', e.message);
    }
  }
  return 0;
}

// ── Send LUNC ────────────────────────────────────────────────────────────────
async function sendLunc(client, from, to, amountUluna, memo) {
  if (process.env.DRY_RUN === '1') throw new Error('DRY_RUN is set — refusing to send funds');
  if (amountUluna < 1000000) {
    console.log('Amount too small to send (<1 LUNC), skipping: ' + to + ' ' + fmt(amountUluna / 1e6) + ' LUNC');
    return null;
  }
  console.log('Sending ' + fmt(amountUluna / 1e6) + ' LUNC to ' + to + ' — ' + memo);
  // Gas: 300k is safe (200k was hitting out-of-gas on columbus-5).
  // Fee on Terra Classic: gas × ~28.3 uluna — use 8.5M uluna for headroom.
  const result = await client.sendTokens(
    from, to,
    [{ denom: DENOM, amount: String(Math.floor(amountUluna)) }],
    { amount: [{ denom: DENOM, amount: '8500000' }], gas: '300000' },
    memo
  );
  if (result.code !== 0) throw new Error('TX failed: ' + result.rawLog);
  console.log('TX hash: ' + result.transactionHash);
  return result.transactionHash;
}

// ── Load / save winners.json ──────────────────────────────────────────────
function loadWinners() {
  if (!fs.existsSync(WINNERS_PATH)) return { daily: [], weekly: [] };
  try { return JSON.parse(fs.readFileSync(WINNERS_PATH, 'utf8')); } catch (e) { return { daily: [], weekly: [] }; }
}

function saveWinners(data) {
  fs.writeFileSync(WINNERS_PATH, JSON.stringify(data, null, 2));
}

// ── Reset free-entries.json after weekly draw ────────────────────────────────
function resetFreeEntries() {
  try {
    const now = new Date().toISOString();
    const empty = {
      _meta: {
        description:  'Free Weekly Draw entries — Terra Oracle protocol',
        sources: {
          chat:      '1 entry per 10 messages total (no daily cap)',
          questions: '2 entries per Oracle question (200k LUNC)',
        },
        updated:      now,
        // history_from = NOW so Update Free Entries finds no activity yet
        history_from: now,
        window_days:  90,
        reset_reason: 'Weekly draw completed — entries consumed',
      },
      entries: {},
    };
    fs.writeFileSync(FREE_ENTRIES_PATH, JSON.stringify(empty, null, 2));
    console.log('Free entries reset after weekly draw. history_from set to:', now);
  } catch(e) {
    console.warn('Could not reset free-entries.json:', e.message);
  }
}

// ── DAILY DRAW ───────────────────────────────────────────────────────────────
async function runDailyDraw(client, operatorAddr) {
  console.log('\n=== DAILY DRAW ===');
  const roundId = getCurrentRoundId('daily');
  console.log('Round: ' + roundId);

  // Already settled? Then this is a second trigger, and running again would
  // pay the prize a second time. Two triggers are deliberate — the Worker's
  // cron is punctual, GitHub's schedule is the fallback — so this check is
  // what makes that safe.
  {
    const _prior = loadWinners();
    if ((_prior.daily || []).some(w => w && w.round_id === roundId)) {
      console.log('Round ' + roundId + ' is already recorded - nothing to do.');
      return;
    }
  }

  // Билеты строятся из NFT-контракта, а не из воркера. Правило описано в
  // chain-tickets.js: жёсткая отсечка minted_at < deadline, порядок по
  // (minted_at, token_id), владелец на высоте блока дедлайна. Любой может
  // собрать тот же список сам и проверить winner_index.
  const deadlineMs = getDrawDeadlineTs();

  // Блок нужен ДО билетов: на его высоте читаются владельцы, иначе перевод
  // NFT между дедлайном и запуском розыгрыша уводил бы приз.
  const blockInfo = await getRoundBlockInfo();

  console.log('Building tickets from the NFT contract...');
  // Граница берётся из winners.json, а не выводится из расписания. 6 августа
  // Actions лежали, розыгрыш не состоялся — но правило по расписанию уже
  // считало пять NFT отыгранными, и они бы молча выпали из игры.
  const dailyBoundary = lastDailyBoundaryTs();
  console.log(dailyBoundary
    ? 'Boundary from winners.json: ' + new Date(dailyBoundary * 1000).toISOString()
    : 'No completed daily on record — falling back to the chain replay');

  const { tickets, tokens, boundaryTs } = await buildTicketsFromChain({
    pool: 'daily',
    deadlineMs,
    blockHeight: blockInfo.height,
    boundaryTs: dailyBoundary === null ? undefined : dailyBoundary,
  });
  const participantCount = new Set(tokens.map(function (t) { return t.owner; })).size;
  console.log('Deadline: ' + new Date(deadlineMs).toISOString() +
              ', unconsumed since: ' + new Date(boundaryTs * 1000).toISOString());
  console.log('Participants: ' + participantCount + ', Tickets: ' + tickets.length);

  if (tickets.length < MIN_ENTRIES) {
    console.log('Not enough entries (' + tickets.length + ' < ' + MIN_ENTRIES + '). Draw skipped — activations roll over to next round.');
    const winners = loadWinners();
    winners.daily.push({
      date:     new Date(deadlineMs).toISOString().slice(0, 10),
      round_id: roundId,
      skipped:  true,
      reason:   'Not enough entries: ' + tickets.length,
      entries:  tickets.length,
    });
    saveWinners(winners);
    return;
  }

  // Get balance
  const balance = await getBalance(DAILY_WALLET);
  console.log('Pool balance: ' + fmt(balance / 1e6) + ' LUNC');

  // Select winner (blockInfo fetched above, before the tickets)
  const blockHash = blockInfo.hash;
  const blockHeight = blockInfo.height;
  const { winner, index } = selectWinner(tickets, blockHash);
  console.log('Block height: ' + blockHeight + ', hash: ' + blockHash);
  console.log('Winner index: ' + index + ' / ' + tickets.length);
  console.log('Winner: ' + winner);

  // Calculate prizes
  const prizePot   = balance;
  const toWinner   = Math.floor(prizePot * DAILY_SPLIT.winner);
  const toTreasury = Math.floor(prizePot * DAILY_SPLIT.treasury);
  // seeds = remainder stays in DAILY_WALLET (no transfer needed)

  console.log('Prize: ' + fmt(toWinner / 1e6) + ' LUNC to winner');
  console.log('Treasury: ' + fmt(toTreasury / 1e6) + ' LUNC');
  console.log('Seeds (stays in pool): ' + fmt((prizePot - toWinner - toTreasury) / 1e6) + ' LUNC');

  // Send prizes
  const txWinner   = await sendLunc(client, operatorAddr, winner, toWinner, 'Oracle Draw — Daily Prize');
  const txTreasury = await sendLunc(client, operatorAddr, TREASURY_WALLET, toTreasury, 'Oracle Draw — Daily Treasury');

  // Mark activations as consumed in Worker
  await markRoundComplete('daily', roundId, winner, txWinner);

  // Save result
  const winners = loadWinners();
  winners.daily.push({
    date:        new Date(deadlineMs).toISOString().slice(0, 10),
    round_id:    roundId,
    winner:      winner,
    prize_lunc:  Math.floor(toWinner / 1e6),
    entries:     tickets.length,
    participants: participantCount,
    ticket_rule:  'chain-v1',
    nft_contract: 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx',
    deadline:     new Date(deadlineMs).toISOString(),
    boundary_ts:  boundaryTs,
    block_hash:   blockHash,
    block_height: blockHeight,
    block_time:   new Date(blockInfo.timeMs).toISOString(),
    randomness:   'terra-classic-block-hash-at-round-deadline',
    winner_index: index,
    tx_winner:   txWinner,
    tx_treasury: txTreasury,
  });
  saveWinners(winners);

  // Снимок билетов раунда для колеса на сайте. Пишется ПОСЛЕ winners.json,
  // чтобы не остаться без пары при падении на последнем шаге.
  writeRoundSnapshot({
    roundId, pool: 'daily',
    tickets, blockHash, blockHeight,
    winnerIndex: index,
  });

  console.log('Daily draw complete!');
}

// ── WEEKLY DRAW ──────────────────────────────────────────────────────────────
async function runWeeklyDraw(client, operatorAddr) {
  console.log('\n=== WEEKLY DRAW ===');
  const roundId = getCurrentRoundId('weekly');
  console.log('Round: ' + roundId);

  // Already settled? Then this is a second trigger, and running again would
  // pay the prize a second time. Two triggers are deliberate — the Worker's
  // cron is punctual, GitHub's schedule is the fallback — so this check is
  // what makes that safe.
  {
    const _prior = loadWinners();
    if ((_prior.weekly || []).some(w => w && w.round_id === roundId)) {
      console.log('Round ' + roundId + ' is already recorded - nothing to do.');
      return;
    }
  }

  // Weekly состоит из двух блоков, и порядок между ними зафиксирован:
  //   1) NFT-билеты из контракта — то же правило, что в daily
  //   2) бесплатные входы из free-entries.json, по возрастанию адреса
  // NFT-часть проверяется по цепи целиком; бесплатная — только по истории
  // коммитов free-entries.json, и об этом честно сказано на странице проверки.
  const deadlineMs = getDrawDeadlineTs();
  const blockInfo = await getRoundBlockInfo();

  console.log('Building NFT tickets from the contract...');
  const weeklyBoundary = lastWeeklyBoundaryTs();
  console.log(weeklyBoundary
    ? 'Boundary from winners.json: ' + new Date(weeklyBoundary * 1000).toISOString()
    : 'No completed weekly on record — falling back to the chain replay');

  const { tickets: nftTickets, tokens, boundaryTs } = await buildTicketsFromChain({
    pool: 'weekly',
    deadlineMs,
    blockHeight: blockInfo.height,
    boundaryTs: weeklyBoundary === null ? undefined : weeklyBoundary,
  });
  const freeTickets = buildFreeTickets();
  const tickets = nftTickets.concat(freeTickets);
  const uniqueAddrs = new Set(tickets);

  console.log('Deadline: ' + new Date(deadlineMs).toISOString() +
              ', unconsumed since: ' + new Date(boundaryTs * 1000).toISOString());
  console.log('NFT tickets: ' + nftTickets.length + ' from ' + tokens.length + ' token(s)' +
              ', free entries: ' + freeTickets.length);
  console.log('Participants: ' + uniqueAddrs.size + ', Tickets: ' + tickets.length);

  // Two thresholds must both pass for weekly: entries count AND pool balance
  if (tickets.length < MIN_ENTRIES) {
    console.log('Not enough entries (' + tickets.length + ' < ' + MIN_ENTRIES + '). Draw skipped.');
    const winners = loadWinners();
    if (!winners.weekly) winners.weekly = [];
    winners.weekly.push({
      date:    new Date(deadlineMs).toISOString().slice(0, 10),
      round_id: roundId,
      skipped: true,
      reason:  'Not enough entries: ' + tickets.length,
      entries: tickets.length,
    });
    saveWinners(winners);
    return;
  }

  const balance = await getBalance(WEEKLY_WALLET);
  console.log('Pool balance: ' + fmt(balance / 1e6) + ' LUNC');

  const balanceLunc = balance / 1e6;
  if (balanceLunc < WEEKLY_MIN_LUNC) {
    console.log('Pool balance too low (' + fmt(balanceLunc) + ' < ' + fmt(WEEKLY_MIN_LUNC) + ' LUNC). Draw skipped — funds roll over.');
    const winners = loadWinners();
    if (!winners.weekly) winners.weekly = [];
    winners.weekly.push({
      date:     new Date(deadlineMs).toISOString().slice(0, 10),
      round_id: roundId,
      skipped:  true,
      reason:   'Pool below minimum: ' + fmt(balanceLunc) + ' / ' + fmt(WEEKLY_MIN_LUNC) + ' LUNC',
      entries:  tickets.length,
      pool_lunc: Math.floor(balanceLunc),
    });
    saveWinners(winners);
    return;
  }

  // Select up to 3 unique winners (limited by unique participant count)
  const uniqueParticipants = uniqueAddrs.size;
  const placesCount = Math.min(3, uniqueParticipants);
  console.log('Unique participants: ' + uniqueParticipants + ' — selecting ' + placesCount + ' winner(s)');

  const blockHash = blockInfo.hash;
  const blockHeight = blockInfo.height;
  console.log('Block height: ' + blockHeight + ', hash: ' + blockHash);

  const places = [];
  let hashSeed = blockHash;

  for (let place = 0; place < placesCount; place++) {
    const seedHash = crypto.createHash('sha256')
      .update(hashSeed + String(place))
      .digest('hex');
    const total = BigInt(tickets.length);
    const hashBig = BigInt('0x' + seedHash.slice(0, 64));
    let idx = Number(hashBig % total);

    const usedAddrs = new Set(places.map(function(p) { return p.address; }));
    let attempts = 0;
    while (usedAddrs.has(tickets[idx]) && attempts < tickets.length) {
      idx = (idx + 1) % tickets.length;
      attempts++;
    }

    places.push({ address: tickets[idx], index: idx, place: place + 1 });
    hashSeed = seedHash;
    console.log('Place ' + (place + 1) + ': ' + tickets[idx] + ' (index ' + idx + ')');
  }

  // Calculate prizes
  const prizePot   = balance;
  const toTreasury = Math.floor(prizePot * WEEKLY_TREASURY);
  // seeds stay in WEEKLY_WALLET

  const txs = [];

  for (const p of places) {
    const split = WEEKLY_SPLIT[p.place - 1];
    const amount = Math.floor(prizePot * split.share);
    const tx = await sendLunc(
      client, operatorAddr, p.address, amount,
      'Oracle Draw — Weekly Prize ' + split.label
    );
    txs.push({ place: p.place, address: p.address, amount_lunc: Math.floor(amount / 1e6), tx,
               winner_index: p.index });
  }

  const txTreasury = await sendLunc(client, operatorAddr, TREASURY_WALLET, toTreasury, 'Oracle Draw — Weekly Treasury');

  // Mark activations as consumed in Worker — ALL places (1st–3rd) get the
  // isWinner flag now, so 2nd/3rd place wins show up in My Wins / My History.
  const primaryWinner = places[0].address;
  const primaryTx     = txs[0]?.tx;
  await markRoundComplete('weekly', roundId, primaryWinner, primaryTx,
    txs.map(function(t) { return { place: t.place, wallet: t.address, txHash: t.tx }; }));

  // Save result
  const winners = loadWinners();
  if (!winners.weekly) winners.weekly = [];
  winners.weekly.push({
    date:        new Date(deadlineMs).toISOString().slice(0, 10),
    round_id:    roundId,
    winners:     txs,
    entries:     tickets.length,
    participants: uniqueAddrs.size,
    ticket_rule:  'chain-v1+free',
    nft_contract: 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx',
    deadline:     new Date(deadlineMs).toISOString(),
    boundary_ts:  boundaryTs,
    nft_tickets:  nftTickets.length,
    free_tickets: freeTickets.length,
    block_hash:   blockHash,
    block_height: blockHeight,
    block_time:   new Date(blockInfo.timeMs).toISOString(),
    randomness:   'terra-classic-block-hash-at-round-deadline',
    tx_treasury: txTreasury,
    seeds_lunc:  Math.floor(prizePot * WEEKLY_SEEDS / 1e6),
  });
  saveWinners(winners);

  writeRoundSnapshot({
    roundId, pool: 'weekly',
    tickets, blockHash, blockHeight,
    winnerIndex: places.map(function (p) { return p.index; }),
  });

  resetFreeEntries(); // entries consumed — reset for next round
  console.log('Weekly draw complete!');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!MNEMONIC) throw new Error('OPERATOR_MNEMONIC not set');

  console.log('Draw type: ' + DRAW_TYPE.toUpperCase());
  console.log('Draw wallet: ' + DRAW_WALLET);

  // Connect wallet
  // Terra Classic uses coin type 330, not standard cosmos 118
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: 'terra',
    hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
  });
  const [account] = await wallet.getAccounts();
  console.log('Operator address: ' + account.address);

  if (account.address !== DRAW_WALLET) {
    // DRY_RUN=1 — прогон логики билетов без боевого ключа. Отправка средств
    // в этом режиме запрещена жёстко, см. sendLunc().
    if (process.env.DRY_RUN === '1') {
      console.warn('DRY_RUN: address mismatch ignored, no funds can be sent');
    } else {
      throw new Error('Mnemonic address ' + account.address + ' does not match expected ' + DRAW_WALLET);
    }
  }

  // Connect to RPC
  let client = null;
  for (const rpc of RPC_NODES) {
    try {
      client = await SigningStargateClient.connectWithSigner(rpc, wallet);
      console.log('Connected to RPC: ' + rpc);
      break;
    } catch (e) {
      console.warn('RPC ' + rpc + ' failed: ' + e.message);
    }
  }
  if (!client) throw new Error('Could not connect to any RPC node');

  if (IS_DAILY) {
    await runDailyDraw(client, account.address);
  } else {
    await runWeeklyDraw(client, account.address);
  }
}

main().catch(function(e) {
  console.error('FATAL:', e.message);
  process.exit(1);
});
