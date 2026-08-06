#!/usr/bin/env node
/**
 * pool-keeper.js — opens and settles rounds in the oracle-pool contracts.
 *
 * Two jobs, both idempotent and self-healing: every run works out what is
 * actually due from on-chain state rather than assuming the previous run
 * succeeded. A missed run is caught up by the next one.
 *
 *   open   — commit the next round while the current one is still taking
 *            entries. That ordering IS the guarantee: the seed is fixed before
 *            the round's participants exist, so nobody can aim the result.
 *   settle — reveal a closed round. Permissionless on the contract, so this
 *            needs no privileged key at all; we run it only so it happens
 *            promptly.
 *
 * Secrets are derived, never stored:
 *     secret = HMAC-SHA256(ORACLE_MASTER_SEED, `${pool}:${roundId}`)
 * There is nothing on disk to lose and nothing in the repo to leak. Losing the
 * master seed means no round can ever be revealed again — funds are still
 * recoverable through RolloverRound, which anyone may call.
 *
 * Env:
 *   ORACLE_MASTER_SEED   64 hex chars
 *   POOL_KEEPER_MNEMONIC signer; only needs to be the pools' config admin,
 *                        NOT the wasm admin that can migrate contracts
 *   POOL_DAILY, POOL_WEEKLY   contract addresses
 *   LCD, RPC, CHAIN_ID   optional overrides
 */
import crypto from 'crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { stringToPath } from '@cosmjs/crypto';

const LCD = process.env.LCD || 'https://terra-classic-lcd.publicnode.com';
const RPC = process.env.RPC || 'https://terra-classic-rpc.publicnode.com';
const CHAIN_ID = process.env.CHAIN_ID || 'columbus-5';
const DENOM = 'uluna';
const GAS_PRICE_ULUNA = 28.325;

/**
 * Fixed gas limits. Generous on purpose: an under-estimated draw would revert
 * after doing all its work, and the round would sit unsettled until somebody
 * noticed. gasUsed is logged so these can be trimmed once there is real data.
 */
const GAS_LIMITS = { open: 400000, settle: 1500000 };

function feeFor(kind) {
  const gas = GAS_LIMITS[kind];
  return {
    amount: [{ denom: DENOM, amount: String(Math.ceil(gas * GAS_PRICE_ULUNA)) }],
    gas: String(gas),
  };
}

/** Open the next round once the current one is within this of closing. */
const OPEN_AHEAD_SECS = 6 * 3600;
/** Never settle more than this in one run — a runaway loop should not drain gas. */
const MAX_SETTLE = 5;

const POOLS = {
  daily: process.env.POOL_DAILY,
  weekly: process.env.POOL_WEEKLY,
};

// ── chain reads ─────────────────────────────────────────────────────────────

async function query(addr, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64');
  const res = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${q}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`query ${JSON.stringify(msg)}: HTTP ${res.status}`);
  const body = await res.json();
  return body.data;
}

/** Block time, not the runner's clock. */
async function chainNowMs() {
  const res = await fetch(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`latest block: HTTP ${res.status}`);
  const body = await res.json();
  return new Date(body.block.header.time).getTime();
}

// ── schedule ────────────────────────────────────────────────────────────────

/** Daily draws at 20:00 UTC every day except Monday; weekly is Monday 20:00. */
function nextDeadlineMs(pool, afterMs) {
  const d = new Date(afterMs);
  d.setUTCHours(20, 0, 0, 0);
  if (d.getTime() <= afterMs) d.setUTCDate(d.getUTCDate() + 1);
  for (;;) {
    const monday = d.getUTCDay() === 1;
    if (pool === 'weekly' ? monday : !monday) return d.getTime();
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// ── secrets ─────────────────────────────────────────────────────────────────

function secretFor(pool, roundId) {
  const master = (process.env.ORACLE_MASTER_SEED || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(master)) {
    throw new Error('ORACLE_MASTER_SEED must be 64 hex chars');
  }
  return crypto
    .createHmac('sha256', Buffer.from(master, 'hex'))
    .update(`${pool}:${roundId}`)
    .digest();
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

// ── signing ─────────────────────────────────────────────────────────────────

async function connect() {
  const mnemonic = process.env.POOL_KEEPER_MNEMONIC;
  if (!mnemonic) throw new Error('POOL_KEEPER_MNEMONIC is not set');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'terra',
    hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
  });
  const [account] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet);
  return { client, address: account.address };
}

// ── actions ─────────────────────────────────────────────────────────────────

async function openIfDue(pool, addr, ctx) {
  const cfg = await query(addr, { config: {} });
  const last = await query(addr, { round: { round_id: cfg.last_round_id } });
  const closeMs = Math.floor(Number(last.close_time) / 1e6);
  const nowMs = await chainNowMs();

  if (closeMs - nowMs > OPEN_AHEAD_SECS * 1000) {
    console.log(`[${pool}] round ${cfg.last_round_id} closes in ` +
      `${Math.round((closeMs - nowMs) / 3600000)}h — nothing to open yet`);
    return;
  }

  const nextId = Number(cfg.last_round_id) + 1;
  const closeTime = nextDeadlineMs(pool, Math.max(closeMs, nowMs));
  const seedHash = sha256(secretFor(pool, nextId)).toString('base64');

  console.log(`[${pool}] opening round ${nextId}, closes ${new Date(closeTime).toISOString()}`);
  if (nowMs >= closeMs) {
    console.warn(`[${pool}] WARNING: round ${cfg.last_round_id} already closed — ` +
      `entries arriving since then predate this commitment and the contract ` +
      `will flag the round has_late_entries`);
  }

  const res = await ctx.client.execute(
    ctx.address,
    addr,
    { open_round: { seed_hash: seedHash, close_time: String(closeTime * 1_000_000) } },
    feeFor('open'),
    `oracle-pool: open ${pool} round ${nextId}`
  );
  console.log(`[${pool}] opened, tx ${res.transactionHash}, gas ${res.gasUsed}/${GAS_LIMITS.open}`);
}

async function settleDue(pool, addr, ctx) {
  for (let i = 0; i < MAX_SETTLE; i++) {
    const cfg = await query(addr, { config: {} });
    const id = Number(cfg.next_unsettled_id);
    if (id > Number(cfg.last_round_id)) {
      console.log(`[${pool}] no round to settle`);
      return;
    }
    const round = await query(addr, { round: { round_id: id } });
    const closeMs = Math.floor(Number(round.close_time) / 1e6);
    const nowMs = await chainNowMs();
    if (nowMs < closeMs) {
      console.log(`[${pool}] round ${id} closes ${new Date(closeMs).toISOString()} — not yet`);
      return;
    }

    const secret = secretFor(pool, id).toString('base64');
    console.log(`[${pool}] settling round ${id}`);
    const res = await ctx.client.execute(
      ctx.address,
      addr,
      { execute_draw: { round_id: id, secret } },
      feeFor('settle'),
      `oracle-pool: settle ${pool} round ${id}`
    );
    console.log(`[${pool}] settled, tx ${res.transactionHash}, gas ${res.gasUsed}/${GAS_LIMITS.settle}`);

    const after = await query(addr, { round: { round_id: id } });
    console.log(`[${pool}] status ${after.status}, entries ${after.total_entries}, ` +
      `pot ${after.pot}, winners ${JSON.stringify(after.winners)}`);
    if (after.has_late_entries) {
      console.warn(`[${pool}] round ${id} carried entries older than its own commitment`);
    }
  }
  console.warn(`[${pool}] stopped after ${MAX_SETTLE} settlements in one run`);
}

// ── main ────────────────────────────────────────────────────────────────────

const action = process.argv[2];
if (!['open', 'settle', 'both'].includes(action)) {
  console.error('usage: pool-keeper.js <open|settle|both>');
  process.exit(1);
}

const ctx = await connect();
console.log(`keeper ${ctx.address} on ${CHAIN_ID}, action=${action}`);

let failed = false;
for (const [pool, addr] of Object.entries(POOLS)) {
  if (!addr) {
    console.log(`[${pool}] no address configured — skipped`);
    continue;
  }
  try {
    if (action === 'settle' || action === 'both') await settleDue(pool, addr, ctx);
    if (action === 'open' || action === 'both') await openIfDue(pool, addr, ctx);
  } catch (e) {
    // One pool failing must not stop the other: they are independent, and a
    // stuck weekly should never block the daily draw.
    console.error(`[${pool}] FAILED: ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
