/**
 * chain-tickets.js — build the draw's ticket list from the NFT contract alone.
 *
 * Replaces fetchParticipants() + buildTickets(), which took the participant set
 * from the Worker at the moment the workflow happened to run. Two problems with
 * that: a delayed start changed who was in the round, and the ordering that
 * decides winner_index came from data only the operator could produce.
 *
 * The rule implemented here — publish it, it is the whole point:
 *
 *   1. A token enters the first draw of its pool after minted_at.
 *   2. A round with fewer than MIN_ENTRIES tickets is skipped and consumes
 *      nothing; those tokens roll into the next round.
 *   3. Tickets are ordered by (minted_at, token_id) with token_id compared as
 *      a plain string, and each token repeats `entries` times.
 *   4. Membership uses a hard cut at the deadline: minted_at < deadline.
 *      Minting at 20:00:01 means the next round, however late the draw runs.
 *   5. The owner is read at the deadline block height, so transferring an NFT
 *      after the deadline cannot move the prize.
 *
 * Given the contract address and the schedule, anyone can rebuild the same list
 * and check winner_index for themselves.
 *
 * Validated against winners.json for 2026-07-26 … 2026-08-04 (six deadlines).
 */

export const NFT_CONTRACT =
  'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx';

export const LCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd-terra-classic.hexxagon.io',
];

export const MIN_ENTRIES = 5;

/**
 * Tokens minted at or after this instant are governed by the rule above.
 * Everything earlier was settled under the old Worker-driven flow and is not
 * replayable — the 2026-07-23 draw ran late and swept in tokens minted after
 * its own deadline. History is left alone on purpose.
 */
export const RULE_START_TS = 1784837749; // 2026-07-23 20:15 UTC

const PAGE = 30;

// ── LCD plumbing ────────────────────────────────────────────────────────────

async function smartQuery(msg, { height } = {}) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64');
  const path = `/cosmwasm/wasm/v1/contract/${NFT_CONTRACT}/smart/${q}`;
  const headers = { Accept: 'application/json' };
  if (height) headers['x-cosmos-block-height'] = String(height);

  let last;
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(base + path, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { last = new Error(`${base}: HTTP ${res.status}`); continue; }
      const body = await res.json();
      if (!body || !body.data) { last = new Error(`${base}: no data field`); continue; }
      return body.data;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`NFT contract query failed on every LCD: ${last && last.message}`);
}

async function allTokenIds() {
  const out = [];
  let startAfter;
  for (;;) {
    const msg = { all_tokens: { limit: PAGE } };
    if (startAfter) msg.all_tokens.start_after = startAfter;
    const { tokens } = await smartQuery(msg);
    if (!tokens || tokens.length === 0) break;
    out.push(...tokens);
    startAfter = tokens[tokens.length - 1];
    if (tokens.length < PAGE) break;
  }
  return out;
}

/** Metadata only — no owner, so this is height-independent and cacheable. */
async function loadTokenMeta() {
  const ids = await allTokenIds();
  const rows = [];
  for (const id of ids) {
    const info = await smartQuery({ nft_info: { token_id: id } });
    const ext = info.extension || {};
    rows.push({
      id,
      pool: ext.pool,
      tier: ext.tier,
      entries: Number(ext.entries || 0),
      mintedAt: Number(ext.minted_at || 0),
    });
  }
  return rows;
}

// ── Schedule ────────────────────────────────────────────────────────────────

/** Daily runs 20:00 UTC every day except Monday; Monday 20:00 is the weekly. */
export function isDeadlineDay(pool, date) {
  const monday = date.getUTCDay() === 1;
  return pool === 'weekly' ? monday : !monday;
}

/** Every deadline for `pool` in (fromMs, toMs], oldest first. */
export function* deadlines(pool, fromMs, toMs) {
  const d = new Date(fromMs);
  d.setUTCHours(20, 0, 0, 0);
  if (d.getTime() <= fromMs) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getTime() <= toMs) {
    if (isDeadlineDay(pool, d)) yield d.getTime();
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// ── The rule ────────────────────────────────────────────────────────────────

function sortTokens(tokens) {
  return tokens.slice().sort((a, b) =>
    a.mintedAt - b.mintedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Replay every past deadline to find the instant from which tokens are still
 * unconsumed. Nothing is stored anywhere: the answer follows from mint times
 * and the schedule.
 */
export function lastConsumedTs(tokens, pool, deadlineMs, minEntries = MIN_ENTRIES) {
  const sorted = sortTokens(tokens);
  let boundary = RULE_START_TS;
  let idx = 0;
  let pendingEntries = 0;

  for (const ts of deadlines(pool, RULE_START_TS * 1000, deadlineMs - 1)) {
    while (idx < sorted.length && sorted[idx].mintedAt * 1000 < ts) {
      pendingEntries += sorted[idx].entries;
      idx++;
    }
    if (pendingEntries >= minEntries) {
      boundary = Math.floor(ts / 1000);
      pendingEntries = 0;
    }
  }
  return boundary;
}

/**
 * The tickets for one round.
 *
 * @returns {{ tickets: string[], tokens: object[], boundaryTs: number }}
 *          `tickets` is the flat array to index with winner_index.
 */
export async function buildTicketsFromChain({
  pool,
  deadlineMs,
  blockHeight,
  minEntries = MIN_ENTRIES,
}) {
  if (!pool) throw new Error('pool is required');
  if (!deadlineMs) throw new Error('deadlineMs is required');

  const meta = (await loadTokenMeta()).filter(
    (t) => t.pool === pool && t.mintedAt >= RULE_START_TS
  );

  const boundaryTs = lastConsumedTs(meta, pool, deadlineMs, minEntries);

  const active = sortTokens(
    meta.filter(
      (t) => t.mintedAt >= boundaryTs && t.mintedAt * 1000 < deadlineMs
    )
  );

  // Owners are read at the deadline height. Without it, a transfer made
  // between the deadline and the draw would redirect the prize.
  const tokens = [];
  for (const t of active) {
    const info = await smartQuery(
      { owner_of: { token_id: t.id } },
      { height: blockHeight }
    );
    tokens.push({ ...t, owner: info.owner });
  }

  const tickets = [];
  for (const t of tokens) {
    for (let i = 0; i < t.entries; i++) tickets.push(t.owner);
  }

  return { tickets, tokens, boundaryTs };
}

// ── Dry run: node chain-tickets.js daily [blockHeight] ──────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = process.argv[2] || 'daily';
  const height = process.argv[3] || undefined;

  const now = new Date();
  const d = new Date(now);
  d.setUTCHours(20, 0, 0, 0);
  if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 1);
  while (!isDeadlineDay(pool, d)) d.setUTCDate(d.getUTCDate() - 1);

  console.log(`pool: ${pool}`);
  console.log(`deadline: ${d.toISOString()}`);
  if (!height) console.log('WARNING: no block height given — owners read at latest state');

  buildTicketsFromChain({ pool, deadlineMs: d.getTime(), blockHeight: height })
    .then(({ tickets, tokens, boundaryTs }) => {
      console.log(`unconsumed since: ${new Date(boundaryTs * 1000).toISOString()}`);
      console.log(`tokens: ${tokens.length}, tickets: ${tickets.length}`);
      for (const t of tokens) {
        console.log(
          `  ${t.id.padEnd(14)}${String(t.entries).padStart(3)} × ${t.owner}` +
          `   minted ${new Date(t.mintedAt * 1000).toISOString()}`
        );
      }
      console.log(
        tickets.length < MIN_ENTRIES
          ? `\nwould SKIP (${tickets.length} < ${MIN_ENTRIES})`
          : `\nwould DRAW — winner_index in 0..${tickets.length - 1}`
      );
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
