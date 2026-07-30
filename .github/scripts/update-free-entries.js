// .github/scripts/update-free-entries.js
// Runs hourly via GitHub Actions
// Reads on-chain tx history via FCD → updates free-entries.json

import fetch from 'node-fetch';
import fs    from 'fs';
import path  from 'path';

// ── Constants ────────────────────────────────────────────────────────────────
const TREASURY_WALLET   = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const DAILY_WALLET      = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET     = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';

// Exclude these senders — they send protocol funds, not user payments
const EXCLUDED_SENDERS  = new Set([DAILY_WALLET, WEEKLY_WALLET, TREASURY_WALLET]);

// A chat message is identified by its EXACT amount (±1%), not by a range.
// The old range [5,000 … 100,000) also swallowed the Treasury leg of questions:
// 25,000 for Basic, 100,000 for Priority, and less than that whenever a rank
// discount applied — every such payment was miscounted as a chat message.
const CHAT_ULUNA          = 5_000_000_000;   // exactly 5,000 LUNC
const CHAT_TOLERANCE      = 0.01;            // ±1%
const CHAT_ENTRIES_PER_10 = 1;
const MAX_CHAT_ENTRIES_PER_ROUND = 20;       // cap per round, not per day —
                                             // entries reset weekly anyway, so a
                                             // weekly cap keeps the remainder of
                                             // messages from burning every day.
const QUESTION_ENTRIES_LEGACY    = 2;        // questions with no `entries` field
const STREAK_14D_ENTRIES  = 2;   // one-time free entries at 14-day streak milestone
const TRUSTED_ENTRIES     = 1;   // Trusted User (30-day streak): +1 per round, backed from RESERVE
const WINDOW_DAYS         = 90;  // scan 90 days back — entries accumulate
const WINDOW_SEC          = WINDOW_DAYS * 86400;

// Terra Oracle Worker — authoritative source for questions and streak milestones
const ORACLE_WORKER   = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
const ACTIONS_SECRET  = process.env.ACTIONS_SECRET || '';  // for secret-gated streak endpoint

const FCD_NODES = [
  'https://terra-classic-fcd.publicnode.com',
  'https://fcd.terra-classic.hexxagon.io',
];

const JSON_PATH = path.resolve('free-entries.json');

// ── Weekly round boundary ─────────────────────────────────────────────────────
// Start of the current weekly draw round (Mon 20:00 UTC). Identical to the
// worker's getCurrentRoundId('weekly') and the frontend fallback in app.js, so
// all three agree on when the week rolls over.
function weeklyRoundStartSec() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
  const diffToMon = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMon);
  if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 7);
  return Math.floor(d.getTime() / 1000);
}

// ── FCD fetch with fallback ──────────────────────────────────────────────────
async function fcdFetch(endpoint) {
  for (const base of FCD_NODES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(base + endpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'TerraOracle/1.0' },
      });
      clearTimeout(timer);
      if (res.ok) return res.json();
      console.warn('FCD ' + base + ' returned ' + res.status);
    } catch (e) {
      console.warn('FCD ' + base + ' failed: ' + e.message);
    }
  }
  throw new Error('All FCD nodes failed for: ' + endpoint);
}

// ── Fetch all txs involving a wallet since cutoff ────────────────────────────
async function fetchTxsTo(wallet, cutoffSec) {
  const result = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = '/v1/txs?account=' + wallet + '&limit=' + limit + '&offset=' + offset;
    let data;
    try {
      data = await fcdFetch(url);
    } catch (e) {
      console.error('fetchTxsTo error:', e.message);
      break;
    }

    const list = data && data.txs ? data.txs : [];
    if (!list.length) break;

    let done = false;
    for (const tx of list) {
      const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
      if (ts < cutoffSec) { done = true; break; }

      const msgs = (tx.tx && tx.tx.value && tx.tx.value.msg) ? tx.tx.value.msg : [];
      const memo = (tx.tx && tx.tx.value && tx.tx.value.memo) ? tx.tx.value.memo : '';

      for (const msg of msgs) {
        if (msg.type !== 'bank/MsgSend') continue;
        const val = msg.value || {};
        if (val.to_address !== wallet) continue;
        const coins = val.amount || [];
        result.push({
          from:  val.from_address,
          coins: coins,
          memo:  memo,
          ts:    ts,
        });
      }
    }

    if (done || list.length < limit) break;
    offset += limit;
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Load existing JSON
  let existing = { _meta: {}, entries: {} };
  if (fs.existsSync(JSON_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } catch (e) {}
  }

  // Variant A — weekly reset. Cutoff = start of the CURRENT weekly draw round
  // (Mon 20:00 UTC). Entries reset automatically every Monday when the draw rolls
  // over, so a single question grants entries in ONE weekly draw only — no
  // carry-over, no re-counting in later draws. Computing the boundary here means
  // it no longer depends on an external resetFreeEntries() call (which was never
  // advancing history_from — it was stuck at the very first date, so 90 days of
  // questions kept counting). A history_from LATER than the weekly boundary is
  // still honored (lets an admin force a mid-week reset); an older/stale one is
  // ignored.
  let cutoff = weeklyRoundStartSec();
  const histRaw = existing && existing._meta && existing._meta.history_from;
  if (histRaw) {
    const histSec = Math.floor(new Date(histRaw).getTime() / 1000);
    if (!Number.isNaN(histSec) && histSec > cutoff) {
      cutoff = histSec;
      console.log('Honoring manual history_from (later than weekly boundary):', histRaw);
    }
  }
  const cutoffIso = new Date(cutoff * 1000).toISOString();
  console.log('Weekly cutoff (round start):', cutoffIso);

  // ── Fetch txs to TREASURY_WALLET (chat) ───────────────────────────────────
  console.log('Fetching txs to TREASURY_WALLET (chat fees)...');
  const treasuryTxs = await fetchTxsTo(TREASURY_WALLET, cutoff);
  console.log('Found ' + treasuryTxs.length + ' treasury txs');

  const chatByWallet = {};
  const questionByWallet = {};
  const streakByWallet = {};
  const trustedByWallet = {};

  // ── Chat: txs to TREASURY_WALLET, exactly 5k LUNC per message (±1%) ───────
  const CHAT_LO = CHAT_ULUNA * (1 - CHAT_TOLERANCE);
  const CHAT_HI = CHAT_ULUNA * (1 + CHAT_TOLERANCE);
  for (const tx of treasuryTxs) {
    if (EXCLUDED_SENDERS.has(tx.from)) continue;
    const uluna = tx.coins.find(function(c) { return c.denom === 'uluna'; });
    if (!uluna) continue;
    const amount = Number(uluna.amount);
    if (amount >= CHAT_LO && amount <= CHAT_HI) {
      const day = new Date(tx.ts * 1000).toISOString().slice(0, 10);
      if (!chatByWallet[tx.from]) chatByWallet[tx.from] = {};
      chatByWallet[tx.from][day] = (chatByWallet[tx.from][day] || 0) + 1;
    }
  }

  // ── Questions: from authoritative questions.json (via Worker /questions) ───
  // NOT from on-chain payments — NFT mints also pay WEEKLY_WALLET and would be
  // miscounted. A question only counts if it's actually recorded as a question.
  // Entries come from the question's own `entries` field, which the Worker
  // derives from the VERIFIED on-chain pool leg (Basic +1, Priority +4).
  // Questions written before tariffs existed have no field → legacy default.
  console.log('Fetching questions from Worker /questions...');
  try {
    const qRes = await fetch(ORACLE_WORKER + '/questions', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'TerraOracle/1.0' },
    });
    if (qRes.ok) {
      const qData = await qRes.json();
      const questions = (qData && qData.questions) ? qData.questions : [];
      for (const q of questions) {
        if (!q.wallet) continue;
        const created = Number(q.createdAt) || 0;   // unix seconds
        if (created < cutoff) continue;               // only this round
        const qe = Number(q.entries) > 0 ? Number(q.entries) : QUESTION_ENTRIES_LEGACY;
        questionByWallet[q.wallet] = (questionByWallet[q.wallet] || 0) + qe;
      }
      console.log('Counted questions from ' + questions.length + ' total records');
    } else {
      console.warn('Worker /questions returned ' + qRes.status);
    }
  } catch (e) {
    console.error('Questions fetch error:', e.message);
  }

  // ── Streak 14-day milestone: one-time +2 free entries (the round it's earned) ─
  if (ACTIONS_SECRET) {
    console.log('Fetching 14-day streak milestones...');
    try {
      const sRes = await fetch(ORACLE_WORKER + '/streak/milestone14-entries?secret=' + encodeURIComponent(ACTIONS_SECRET), {
        headers: { 'Accept': 'application/json', 'User-Agent': 'TerraOracle/1.0' },
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        for (const m of (sData.wallets || [])) {
          if (!m.wallet || !m.achievedAt) continue;
          const achievedSec = Math.floor(new Date(m.achievedAt).getTime() / 1000);
          if (achievedSec < cutoff) continue;          // only the round it was earned
          streakByWallet[m.wallet] = (streakByWallet[m.wallet] || 0) + STREAK_14D_ENTRIES;
        }
        console.log('Streak milestone wallets credited: ' + Object.keys(streakByWallet).length);
      } else {
        console.warn('Worker /streak/milestone14-entries returned ' + sRes.status);
      }
    } catch (e) {
      console.error('Streak milestone fetch error:', e.message);
    }
  } else {
    console.warn('ACTIONS_SECRET not set — skipping 14-day streak entries');
  }

  // ── Trusted User (30-day streak): +1 entry per round ──────────────────────
  // The Worker only lists wallets whose 25,000 LUNC backing transfer has already
  // landed in the Weekly pool, so this entry is always paid for before it counts.
  if (ACTIONS_SECRET) {
    console.log('Fetching Trusted User entries...');
    try {
      const tRes = await fetch(ORACLE_WORKER + '/streak/trusted-entries?secret=' + encodeURIComponent(ACTIONS_SECRET), {
        headers: { 'Accept': 'application/json', 'User-Agent': 'TerraOracle/1.0' },
      });
      if (tRes.ok) {
        const tData = await tRes.json();
        for (const t of (tData.wallets || [])) {
          if (!t.wallet) continue;
          trustedByWallet[t.wallet] = TRUSTED_ENTRIES;   // one per round, not cumulative
        }
        console.log('Trusted User wallets credited: ' + Object.keys(trustedByWallet).length);
      } else {
        console.warn('Worker /streak/trusted-entries returned ' + tRes.status);
      }
    } catch (e) {
      console.error('Trusted entries fetch error:', e.message);
    }
  } else {
    console.warn('ACTIONS_SECRET not set — skipping Trusted User entries');
  }

  // ── Calculate entries ─────────────────────────────────────────────────────
  const allWallets = new Set([
    ...Object.keys(chatByWallet),
    ...Object.keys(questionByWallet),
    ...Object.keys(streakByWallet),
    ...Object.keys(trustedByWallet),
  ]);
  console.log('Chat: ' + Object.keys(chatByWallet).length + ', Questions: ' + Object.keys(questionByWallet).length + ', Streak: ' + Object.keys(streakByWallet).length + ', Trusted: ' + Object.keys(trustedByWallet).length);

  const entries = {};
  let cappedWallets = 0;
  for (const wallet of allWallets) {
    // Chat entries: floor(total_msgs/10), capped per round
    let chatTotal = 0;
    if (chatByWallet[wallet]) {
      let totalMsgs = 0;
      for (const day of Object.values(chatByWallet[wallet])) {
        totalMsgs += day;
      }
      const uncapped = Math.floor(totalMsgs / 10) * CHAT_ENTRIES_PER_10;
      chatTotal = Math.min(uncapped, MAX_CHAT_ENTRIES_PER_ROUND);
      if (uncapped > chatTotal) cappedWallets++;
    }

    // Question entries: already summed per tariff above
    const qEntries = questionByWallet[wallet] || 0;

    // Streak 14-day milestone entries (one-time)
    const sEntries = streakByWallet[wallet] || 0;

    // Trusted User entry (30-day streak, one per round)
    const tEntries = trustedByWallet[wallet] || 0;

    const total = chatTotal + qEntries + sEntries + tEntries;
    if (total > 0) {
      entries[wallet] = {
        chat:      chatTotal,
        questions: qEntries,
        streak:    sEntries,
        trusted:   tEntries,
        total:     total,
      };
    }
  }
  if (cappedWallets) console.log('Chat cap applied to ' + cappedWallets + ' wallet(s)');

  // ── Write JSON ────────────────────────────────────────────────────────────
  const output = {
    _meta: {
      description:  'Free Weekly Draw entries — Terra Oracle protocol',
      sources: {
        chat:      '1 entry per 10 messages, max ' + MAX_CHAT_ENTRIES_PER_ROUND + ' per round',
        questions: 'entries per question tariff (Basic +1, Priority +4)',
        streak:    '2 one-time entries at 14-day streak milestone',
        trusted:   '1 entry per round for Trusted Users (30-day streak), backed from Reserve',
      },
      updated:     new Date().toISOString(),
      history_from: cutoffIso,  // start of current weekly round — entries counted since here
      resets:       'weekly (Mon 20:00 UTC)',
    },
    entries: entries,
  };

  fs.writeFileSync(JSON_PATH, JSON.stringify(output, null, 2));

  const totalEntries = Object.values(entries).reduce(function(s, e) { return s + e.total; }, 0);
  console.log('Done: ' + allWallets.size + ' wallets, ' + totalEntries + ' total entries');
}

main().catch(function(e) { console.error(e); process.exit(1); });
