// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT - закрытие раунда
// ═══════════════════════════════════════════════════════════════════════════
//
// Запускается по крону часто (раз в 10–15 минут). Сам решает, пора ли
// закрывать раунд: доска заполнена или истёк дедлайн. Если ни то ни другое -
// молча выходит.
//
// Порядок ровно тот же, что в lottery-draw.js, и по тем же причинам:
//   1. Блок берётся ПО ДЕДЛАЙНУ РАУНДА, а не последний на момент запуска.
//      Иначе результат зависит от того, когда стартовал раннер, и перезапуск
//      до удачного хеша становится возможен.
//   2. Фолбэка на sha256(Date.now()) НЕТ. Блок недоступен - раунд не
//      закрывается, зоны и банк остаются на месте до следующего запуска.
//   3. Победитель считается ЗДЕСЬ, воркер только фиксирует итог.
//
// ВАЖНО: package.json репозитория содержит "type": "module". Только import,
// только с явным расширением .js. require() здесь роняет всё на старте -
// так пропали daily 2026-08-02 и weekly 2026-08-03.

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath }            from '@cosmjs/crypto';
import { SigningStargateClient }   from '@cosmjs/stargate';
import fs   from 'fs';
import path from 'path';

// ── Настройки ──────────────────────────────────────────────────────────────
const WORKER   = process.env.CIRCUIT_WORKER_URL || 'https://oracle-draw.vladislav-baydan.workers.dev';
const SECRET   = process.env.DISTRIBUTION_SECRET;
const MNEMONIC = process.env.OPERATOR_MNEMONIC_CIRCUIT;
const TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const DENOM    = 'uluna';
const PREFIX   = 'terra';
const RPC      = process.env.RPC_URL || 'https://terra-classic-rpc.publicnode.com:443';

const LCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://rest.cosmos.directory/terraclassic',
  'https://terra-classic-lcd.hexxagon.io',
  'https://lcd.terraclassic.community',
];

// Утешительная доля соседним блокам. Решение ещё не закреплено, поэтому
// вынесено флагом: 0 полностью отключает, логика остаётся нетронутой.
const NEIGHBOUR_SHARE = Number(process.env.CIRCUIT_NEIGHBOUR_SHARE ?? '0.05');

const MAX_WAIT_MS   = 10 * 60 * 1000;   // сколько ждать появления блока дедлайна
const SNAPSHOT_DIR  = 'rounds';

const fmt = n => Math.floor(n).toLocaleString('en-US');

// ── Воркер ─────────────────────────────────────────────────────────────────
async function getState() {
  const r = await fetch(WORKER + '/circuit/state', { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('circuit/state failed: ' + r.status);
  return r.json();
}

async function closeRound(body) {
  const r = await fetch(WORKER + '/circuit/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('circuit/close failed: ' + r.status + ' ' + JSON.stringify(d));
  return d;
}

// ── Блоки ──────────────────────────────────────────────────────────────────
async function fetchBlock(heightOrLatest) {
  const suffix = heightOrLatest === 'latest' ? 'latest' : String(heightOrLatest);
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(base + '/cosmos/base/tendermint/v1beta1/blocks/' + suffix, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const hashRaw = data?.block_id?.hash;
      const header  = data?.block?.header;
      if (!hashRaw || !header) continue;
      return {
        hash:   Buffer.from(hashRaw, 'base64').toString('hex').toUpperCase(),
        height: Number(header.height),
        timeMs: new Date(header.time).getTime(),
      };
    } catch (e) {
      console.warn('block fetch failed from ' + base + ': ' + e.message);
    }
  }
  return null;
}

// Первый блок с timestamp >= targetMs. Бинарный поиск, ~15 запросов.
async function findBlockAtOrAfter(targetMs) {
  const latest = await fetchBlock('latest');
  if (!latest) return null;
  if (latest.timeMs < targetMs) return null;      // дедлайн ещё не наступил в цепи

  const AVG_BLOCK_MS = 6000;
  const span = Math.ceil((latest.timeMs - targetMs) / AVG_BLOCK_MS * 2) + 100;
  let lo = Math.max(1, latest.height - span);
  let hi = latest.height;

  const loBlock = await fetchBlock(lo);
  if (!loBlock) return null;
  if (loBlock.timeMs >= targetMs) return loBlock;

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

// Ждём по времени ЦЕПИ, а не по часам раннера: дедлайн определён в терминах
// блоков, и только это время имеет значение.
async function waitForDeadline(deadlineMs) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const latest = await fetchBlock('latest');
    if (latest && latest.timeMs >= deadlineMs) return true;
    const left = Math.round((deadlineMs - (latest?.timeMs ?? Date.now())) / 1000);
    console.log('waiting for the deadline block, ~' + left + 's by chain time');
    await new Promise(r => setTimeout(r, 15000));
  }
  return false;
}

// ── Победитель ─────────────────────────────────────────────────────────────
// Ровно та же формула, что показана на странице проверки и в макете:
// зона = BigInt("0x" + block_hash) % проданных зон.
function selectZone(blockHash, sold) {
  return Number(BigInt('0x' + blockHash) % BigInt(sold));
}

function ownerOfZone(blocks, zone) {
  return blocks.find(b => zone >= b.from && zone <= b.to) || null;
}

// Блоки, стоящие вплотную к победившему, но принадлежащие другим кошелькам
function neighboursOf(blocks, zone, sold) {
  const win = ownerOfZone(blocks, zone);
  const out = [];
  for (const side of [zone - 1, zone + 1]) {
    if (side < 0 || side >= sold) continue;
    const b = ownerOfZone(blocks, side);
    if (!b) continue;
    if (win && b.wallet === win.wallet) continue;
    if (out.some(x => x.wallet === b.wallet)) continue;
    out.push(b);
  }
  return out;
}

// ── Кошелёк ────────────────────────────────────────────────────────────────
async function getClient() {
  if (!MNEMONIC) throw new Error('OPERATOR_MNEMONIC_CIRCUIT is not set');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: PREFIX, hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
  });
  const [account] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(RPC, wallet);
  return { client, address: account.address };
}

// ── Отметки об уже отправленных переводах ──────────────────────────────────
// Скрипт падал на середине выплат дважды: 15 августа не доплатил долю выкупа,
// 17-го чуть не отправил приз второй раз. Воркер хранит отметку по каждому
// переводу раунда, и повтор продолжает с места, а не начинает сначала.
async function fetchPayoutMarks(roundId) {
  const r = await fetch(WORKER + '/circuit/payouts?roundId=' + encodeURIComponent(roundId),
                        { headers: { Authorization: 'Bearer ' + SECRET } });
  // Не знаем, что уже ушло - платить вслепую нельзя.
  if (!r.ok) throw new Error('cannot read payout marks: HTTP ' + r.status);
  return (await r.json()).marks || {};
}

async function markPayout(roundId, leg, txHash) {
  const r = await fetch(WORKER + '/circuit/payouts', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roundId, leg, txHash }),
  });
  // Деньги ушли, а отметка не легла - самое опасное состояние: повтор заплатит
  // второй раз. Останавливаемся и говорим громко, с хешем в тексте.
  if (!r.ok) {
    throw new Error('SENT BUT NOT RECORDED - leg ' + leg + ', tx ' + txHash +
                    ' - record it manually before re-running');
  }
}

async function sendLunc(client, from, to, amountUluna, memo) {
  if (process.env.DRY_RUN === '1') throw new Error('DRY_RUN is set - refusing to send funds');
  if (amountUluna < 1_000_000) {
    console.log('too small to send (<1 LUNC), skipped: ' + to);
    return null;
  }
  console.log('sending ' + fmt(amountUluna / 1e6) + ' LUNC to ' + to + ' - ' + memo);
  const res = await client.sendTokens(
    from, to,
    [{ denom: DENOM, amount: String(Math.floor(amountUluna)) }],
    { amount: [{ denom: DENOM, amount: '8500000' }], gas: '300000' },
    memo
  );
  if (res.code !== 0) throw new Error('tx failed: ' + res.rawLog);
  console.log('tx: ' + res.transactionHash);
  return res.transactionHash;
}

// ── Снимок раунда ──────────────────────────────────────────────────────────
// Пишется ПОСЛЕ выплат, но ДО вызова /circuit/close: если close не пройдёт,
// снимок останется и раунд можно будет разобрать вручную.
function writeSnapshot(round, blockInfo, zone, winner, payouts) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = path.join(SNAPSHOT_DIR, round.roundId + '.json');
  const data = {
    _verify: [
      'Frozen board for this Circuit round, exactly as the draw used it.',
      '1. blocks are consecutive: [wallet, from, to]. The sold part has no gaps.',
      '2. total_sold must equal the sum of all block lengths.',
      '3. winner_zone = BigInt("0x" + block_hash) % total_sold',
      '4. the wallet owning winner_zone must equal `winner` below.',
      '',
      'The block is not the latest one at run time: it is the first block with a',
      'timestamp at or after the round deadline, found by binary search. That makes',
      'the result independent of when the script actually ran.',
    ],
    round_id:    round.roundId,
    opened_at:   new Date(round.openedAt).toISOString(),
    deadline:    new Date(round.deadline).toISOString(),
    total_sold:  round.sold,
    max_zones:   round.maxZones,
    pool_uluna:  round.poolUluna,
    split:       round.split,
    block_hash:   blockInfo.hash,
    block_height: blockInfo.height,
    block_time:   new Date(blockInfo.timeMs).toISOString(),
    randomness:  'terra-classic-block-hash-at-round-deadline',
    winner_zone: zone,
    winner:      winner.wallet,
    blocks:      round.blocks.map(b => [b.wallet, b.from, b.to]),
    payouts,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('snapshot written: ' + file);
  return file;
}

// ── Главное ────────────────────────────────────────────────────────────────
async function main() {
  const round = await getState();
  const now = Date.now();

  console.log('round ' + round.roundId + ' - ' + round.sold + '/' + round.maxZones +
              ' zones, pool ' + fmt(round.poolUluna / 1e6) + ' LUNC');

  const full    = round.sold >= round.maxZones;
  const expired = now >= round.deadline;
  if (!full && !expired) {
    console.log('not time yet: ' + Math.round((round.deadline - now) / 60000) + ' min left, board not full');
    return;
  }

  // Недобор - деньги НЕ возвращаются, зоны и банк переносятся вперёд.
  // Блок здесь не нужен: розыгрыша не будет.
  if (round.sold < round.minZones) {
    console.log('below the minimum (' + round.sold + ' < ' + round.minZones + ') - merging into the next round');
    const res = await closeRound({});
    console.log('merged, carried ' + fmt((res.carried || 0) / 1e6) + ' LUNC into ' + res.nextRound);
    return;
  }

  // Блок дедлайна. Если ещё не наступил по времени цепи - ждём, но недолго:
  // упавший запуск не страшен, следующий крон повторит.
  if (!(await waitForDeadline(round.deadline))) {
    console.log('deadline block has not appeared within the wait window - leaving the round open');
    return;
  }
  const blockInfo = await findBlockAtOrAfter(round.deadline);
  if (!blockInfo) {
    console.log('could not resolve the deadline block - leaving the round open, will retry');
    return;
  }
  console.log('deadline block ' + blockInfo.height + ' at ' + new Date(blockInfo.timeMs).toISOString());
  console.log('hash ' + blockInfo.hash);

  const zone   = selectZone(blockInfo.hash, round.sold);
  const winner = ownerOfZone(round.blocks, zone);
  if (!winner) throw new Error('zone ' + zone + ' has no owner - board is inconsistent');
  console.log('winning zone ' + zone + ' -> ' + winner.wallet);

  const { client, address } = await getClient();

  // Кошельки долей TCO. Деньги переводятся туда сразу при закрытии раунда,
  // чтобы обязательство было видно НА ЦЕПОЧКЕ, а не только счётчиком в KV:
  // пропадёт база - пропадёт и след, а баланс кошелька проверит кто угодно.
  // Сюда стекается вся доля TCO (6% + 6%) и отсюда идёт единственная
  // покупка в конце эпохи. Ключ этого кошелька - единственный, который
  // нужен скрипту эпохи.
  const TCO_BUYBACK_WALLET = 'terra1x3axkacpes4d8q2svfeneqdtv8rvcvccrn66j5';

  // Выплаты. Утешительная доля соседям берётся ИЗ призового фонда, а не сверх.
  const prizeTotal = round.split.prize;
  const neigh      = NEIGHBOUR_SHARE > 0 ? neighboursOf(round.blocks, zone, round.sold) : [];
  const perNeigh   = neigh.length ? Math.floor(prizeTotal * NEIGHBOUR_SHARE / neigh.length) : 0;
  const toWinner   = prizeTotal - perNeigh * neigh.length;

  const marks = await fetchPayoutMarks(round.roundId);
  const done = Object.keys(marks);
  if (done.length) console.log('already paid in an earlier run: ' + done.join(', '));

  // Каждый перевод отмечается сразу после отправки, до следующего.
  const payOnce = async (leg, to, uluna, memo) => {
    if (marks[leg]) {
      console.log('skip ' + leg + ' - already sent, tx ' + marks[leg]);
      return marks[leg];
    }
    const tx = await sendLunc(client, address, to, uluna, memo);
    if (tx) await markPayout(round.roundId, leg, tx);
    return tx;
  };

  const payouts = { winner: null, neighbours: [], treasury: null,
                    tcoDrop: null, tcoBurn: null };
  payouts.winner = {
    wallet: winner.wallet, uluna: toWinner,
    tx: await payOnce('winner', winner.wallet, toWinner,
                      'Circuit ' + round.roundId + ' - zone ' + zone),
  };
  for (const n of neigh) {
    payouts.neighbours.push({
      wallet: n.wallet, uluna: perNeigh,
      tx: await payOnce('neighbour:' + n.wallet, n.wallet, perNeigh,
                        'Circuit ' + round.roundId + ' - neighbour of zone ' + zone),
    });
  }
  payouts.treasury = {
    wallet: TREASURY, uluna: round.split.treasury,
    tx: await payOnce('treasury', TREASURY, round.split.treasury,
                      'Circuit ' + round.roundId + ' - treasury'),
  };
  // Доли TCO уходят на свои кошельки и ЖДУТ там.
  //
  // Раздача: покупка идёт партией в конце эпохи - покупать по 31 центу за
  // раунд бессмысленно, комиссия свопа и проскальзывание съедят больше.
  // Доля каждого участника уже зафиксирована воркером в LUNC.
  //
  // Сжигание: не включается до попадания в белый список. До тех пор доля
  // просто копится - ни покупки, ни сжигания.
  //
  // Поле split.tcoDrop появилось вместе с разделением 6/6; пока воркер
  // старой версии, его нет, и переводы молча пропускаются.
  // Обе доли уходят ОДНИМ переводом на кошелёк выкупа. Разделение
  // произойдёт после покупки: скрипт эпохи поделит купленный TCO пополам -
  // половину в claim-контракт, половину на бёрн-кошелёк.
  //
  // Бёрн-кошелёк только принимает, его ключ в CI не нужен.
  const dropUluna = round.split.tcoDrop || 0;
  const burnUluna = round.split.tcoBurn || 0;
  const tcoUluna  = dropUluna + burnUluna;

  if (tcoUluna > 0) {
    const tx = await payOnce('tco', TCO_BUYBACK_WALLET, tcoUluna,
                             'Circuit ' + round.roundId + ' - TCO buyback share');
    // Суммы пишем раздельно: пропорция 6/6 должна быть видна в снимке
    // раунда, даже когда перевод один.
    payouts.tcoDrop = { wallet: TCO_BUYBACK_WALLET, uluna: dropUluna, purpose: 'rewards', tx };
    payouts.tcoBurn = { wallet: TCO_BUYBACK_WALLET, uluna: burnUluna, purpose: 'burn', tx };
  } else {
    console.log('WARNING: split has no tcoDrop/tcoBurn - worker is on the old format, TCO shares stay in the pool wallet');
  }

  writeSnapshot(round, blockInfo, zone, winner, payouts);

  const res = await closeRound({
    winnerZone:  zone,
    blockHash:   blockInfo.hash,
    blockHeight: blockInfo.height,
    blockTime:   new Date(blockInfo.timeMs).toISOString(),
    txWinner:    payouts.winner.tx,
  });
  console.log('round closed. TCO pending: ' + fmt((res.tcoPending || 0) / 1e6) + ' LUNC');
}

main().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
