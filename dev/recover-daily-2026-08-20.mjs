/* ═══════════════════════════════════════════════════════════════════════════
   ВОССТАНОВЛЕНИЕ ЗАПИСИ О РОЗЫГРЫШЕ daily_2026-08-20
   ---------------------------------------------------------------------------
   20 августа прогон #195 разыграл раунд, отправил приз и казну, а пуш отбило
   гонкой за ветку. Деньги на цепи есть, записи в winners.json нет. Пока её нет,
   защита от повтора в lottery-draw.js не видит раунд закрытым и следующий
   запуск заплатил бы второй раз.

   Скрипт НИЧЕГО не отправляет и ничего не выдумывает. Он пересобирает билеты
   с цепи на той же высоте блока, что и упавший прогон, и проверяет, что из них
   получается тот же победитель с тем же индексом. Совпало - пишет запись и
   снимок раунда. Не совпало - останавливается и ничего не трогает.

   ЗАПУСК (нужен интернет, из корня репозитория):
       node dev/recover-daily-2026-08-20.mjs
       node dev/recover-daily-2026-08-20.mjs --write     ← собственно запись

   Без --write это сухой прогон: покажет, что получилось, и выйдет.
   ═══════════════════════════════════════════════════════════════════════════ */

import fs from 'fs';
import { buildTicketsFromChain } from '../chain-tickets.js';
import { writeRoundSnapshot } from '../round-snapshot.js';

// ── Всё, что известно из лога прогона #195. Ничего отсюда не пересчитывается,
// эти значения только СВЕРЯЮТСЯ с тем, что придёт с цепи.
const FACT = {
  roundId:     'daily_2026-08-20',
  deadlineIso: '2026-08-20T20:00:00.000Z',
  boundaryIso: '2026-08-18T20:00:00.000Z',
  blockHeight: 30036889,
  blockHash:   '3498957A96A5DFDB57E2FAFC106E9D1C65CDC913D960393F84332C49ADA6CFB6',
  blockTime:   '2026-08-20T20:00:02.810Z',
  winner:      'terra1jhtmkmakjvvtwur05klc7fd72e5n39m4x75c2l',
  winnerIndex: 4,
  tickets:     6,
  participants: 4,
  prizeLunc:   11936,
  txWinner:    '2B9B367451D9A907FB8EBF37E0EBEF89FC7C18751AB0700238B1897FF1116143',
  txTreasury:  '4FD7AE3F1441AA5463EDE2C2DDABCBD8B555FDD2E2C39849806753F8F2564E85',
  nftContract: 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx',
};

const WRITE = process.argv.includes('--write');

// Тот же снимок метаданных, что пишет lottery-draw.js: по одному токену на
// кошелёк, чтобы колесо на сайте показывало тир и номер.
function snapshotMeta(tokens) {
  const meta = {};
  for (const t of tokens || []) {
    if (t && t.owner && !meta[t.owner]) meta[t.owner] = { tokenId: t.id, tier: t.tier };
  }
  return meta;
}
const die = (m) => { console.error('ОСТАНОВЛЕНО: ' + m); process.exit(1); };

const deadlineMs = new Date(FACT.deadlineIso).getTime();
const boundaryTs = Math.floor(new Date(FACT.boundaryIso).getTime() / 1000);

console.log('Восстанавливаем ' + FACT.roundId);
console.log('Блок ' + FACT.blockHeight + ', дедлайн ' + FACT.deadlineIso);

// ── 1. Раунд ещё не записан? ────────────────────────────────────────────────
const winners = JSON.parse(fs.readFileSync('winners.json', 'utf8'));
if ((winners.daily || []).some((w) => w && w.round_id === FACT.roundId)) {
  die('раунд уже есть в winners.json - восстанавливать нечего');
}

// ── 2. Пересобираем билеты с цепи ───────────────────────────────────────────
// Тот же вызов, что в lottery-draw.js: жёсткая отсечка minted_at < deadline,
// владельцы читаются на высоте блока дедлайна. Результат обязан совпасть.
console.log('\nСобираем билеты с NFT-контракта...');
const { tickets, tokens, boundaryTs: rebuiltBoundary } = await buildTicketsFromChain({
  pool: 'daily',
  deadlineMs,
  blockHeight: FACT.blockHeight,
  boundaryTs,
});

const participantCount = new Set(tokens.map((t) => t.owner)).size;
console.log('Билетов: ' + tickets.length + ', кошельков: ' + participantCount);

if (rebuiltBoundary !== boundaryTs) {
  die('граница пересчиталась как ' + new Date(rebuiltBoundary * 1000).toISOString() +
      ', а в логе прогона была ' + FACT.boundaryIso);
}
if (participantCount !== FACT.participants) {
  die('участников ' + participantCount + ', а в логе было ' + FACT.participants);
}

if (tickets.length !== FACT.tickets) {
  die('билетов ' + tickets.length + ', а в логе прогона было ' + FACT.tickets +
      '. Список не воспроизвёлся - записывать нельзя');
}

// tickets - плоский список адресов, по одному на билет: победитель берётся
// прямо по индексу, ровно как в lottery-draw.js.
const rebuiltWallet = tickets[FACT.winnerIndex];
if (String(rebuiltWallet) !== FACT.winner) {
  die('на индексе ' + FACT.winnerIndex + ' оказался ' + rebuiltWallet +
      ', а приз ушёл на ' + FACT.winner + '. Расхождение - записывать нельзя');
}
console.log('Победитель на индексе ' + FACT.winnerIndex + ' совпал с выплатой.');

if (!WRITE) {
  console.log('\nСухой прогон. Всё сходится. Запустите с --write, чтобы записать.');
  process.exit(0);
}

// ── 3. Запись, ровно в той же форме, что пишет lottery-draw.js ──────────────
winners.daily.push({
  date:         FACT.deadlineIso.slice(0, 10),
  round_id:     FACT.roundId,
  winner:       FACT.winner,
  prize_lunc:   FACT.prizeLunc,
  entries:      tickets.length,
  participants: participantCount,
  ticket_rule:  'chain-v1',
  nft_contract: FACT.nftContract,
  deadline:     FACT.deadlineIso,
  boundary_ts:  boundaryTs,
  block_hash:   FACT.blockHash,
  block_height: FACT.blockHeight,
  block_time:   FACT.blockTime,
  randomness:   'terra-classic-block-hash-at-round-deadline',
  winner_index: FACT.winnerIndex,
  tx_winner:    FACT.txWinner,
  tx_treasury:  FACT.txTreasury,
  recovered:    'запись восстановлена вручную: выплата прошла в прогоне #195 ' +
                '20 августа, коммит не сохранился из-за гонки за ветку',
});
fs.writeFileSync('winners.json', JSON.stringify(winners, null, 2) + '\n');
console.log('winners.json дополнен.');

writeRoundSnapshot({
  roundId: FACT.roundId,
  pool: 'daily',
  tickets,
  blockHash: FACT.blockHash,
  blockHeight: FACT.blockHeight,
  winnerIndex: FACT.winnerIndex,
  meta: snapshotMeta(tokens),
});
console.log('Снимок раунда записан.');
console.log('\nГотово. Проверьте git diff, затем коммит и пуш.');
