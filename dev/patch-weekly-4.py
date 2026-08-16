#!/usr/bin/env python3
"""Weekly boundary comes from winners.json, not from a chain replay.

Why: whether a weekly round happened depends on NFT entries PLUS free entries
PLUS the pool balance. Free entries are off-chain, so the boundary simply is not
derivable from the chain - pretending otherwise would silently mis-assign tokens
the first time a round passes on free entries alone.

Daily keeps the chain replay: one source, self-contained rule, nothing to trust.
"""
import sys

CT = "chain-tickets.js"
LD = "lottery-draw.js"

# ── 1. chain-tickets.js: allow an explicit boundary ────────────────────────
src = open(CT).read()

old = """export async function buildTicketsFromChain({
  pool,
  deadlineMs,
  blockHeight,
  minEntries = MIN_ENTRIES,
}) {"""
new = """export async function buildTicketsFromChain({
  pool,
  deadlineMs,
  blockHeight,
  minEntries = MIN_ENTRIES,
  boundaryTs: boundaryOverride,
}) {"""

if "boundaryOverride" in src:
    print("skip: chain-tickets signature")
elif src.count(old) != 1:
    sys.exit(f"buildTicketsFromChain signature: {src.count(old)} matches")
else:
    src = src.replace(old, new, 1)

    old2 = "  const boundaryTs = lastConsumedTs(meta, pool, deadlineMs, minEntries);"
    new2 = """  // Граница «отыграно». Для daily она выводится из цепи: источник входов один,
  // и правило самодостаточно. Для weekly её обязан передать вызывающий - там
  // состоялся ли раунд, зависит ещё и от бесплатных входов и от баланса пула,
  // а этого в цепи нет. Молча посчитать её здесь означало бы выдать догадку
  // за проверяемый факт.
  const boundaryTs = boundaryOverride != null
    ? boundaryOverride
    : lastConsumedTs(meta, pool, deadlineMs, minEntries);"""
    if src.count(old2) != 1:
        sys.exit(f"boundary line: {src.count(old2)} matches")
    src = src.replace(old2, new2, 1)
    open(CT, "w").write(src)
    print("ok: chain-tickets accepts an explicit boundary")

# ── 2. lottery-draw.js: helper reading the boundary from winners.json ──────
src = open(LD).read()

if "function lastWeeklyBoundaryTs" in src:
    print("skip: lastWeeklyBoundaryTs")
else:
    anchor = "// Бесплатные входы как упорядоченный список билетов."
    i = src.find(anchor)
    if i == -1:
        sys.exit("could not find buildFreeTickets section")
    helper = """// Граница «отыграно» для weekly.
//
// Берётся из последней НЕпропущенной weekly-записи: её дедлайн и есть момент,
// до которого все NFT этого пула уже сыграли. Вычислить её из цепи нельзя -
// раунд мог состояться за счёт бесплатных входов, которых в цепи нет, или
// сорваться из-за баланса пула ниже WEEKLY_MIN_LUNC.
//
// Значит weekly проверяем не полностью: NFT-часть списка любой пересоберёт по
// цепи, а вот эта граница берётся из winners.json, то есть из файла, который
// ведём мы. Проверить его можно по истории коммитов - слабее цепи, но это
// настоящий предел, а не наша небрежность.
function lastWeeklyBoundaryTs() {
  const winners = loadWinners();
  const done = (winners.weekly || []).filter(function (w) { return !w.skipped; });
  if (done.length === 0) return null;

  const last = done[done.length - 1];
  // Новые записи несут deadline явно; старые - только дату, а weekly всегда
  // закрывается в понедельник в 20:00 UTC.
  const iso = last.deadline ||
    ((last.date || String(last.round_id || '').replace('weekly_', '')) + 'T20:00:00Z');
  const ts = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(ts)) {
    console.warn('Could not read the weekly boundary from winners.json: ' + iso);
    return null;
  }
  return ts;
}

"""
    src = src[:i] + helper + src[i:]
    open(LD, "w").write(src)
    print("ok: lastWeeklyBoundaryTs")

# ── 3. pass it into the weekly draw ────────────────────────────────────────
src = open(LD).read()
old = """  const { tickets: nftTickets, tokens, boundaryTs } = await buildTicketsFromChain({
    pool: 'weekly',
    deadlineMs,
    blockHeight: blockInfo.height,
  });"""
new = """  const weeklyBoundary = lastWeeklyBoundaryTs();
  console.log(weeklyBoundary
    ? 'Boundary from winners.json: ' + new Date(weeklyBoundary * 1000).toISOString()
    : 'No completed weekly on record - falling back to the chain replay');

  const { tickets: nftTickets, tokens, boundaryTs } = await buildTicketsFromChain({
    pool: 'weekly',
    deadlineMs,
    blockHeight: blockInfo.height,
    boundaryTs: weeklyBoundary === null ? undefined : weeklyBoundary,
  });"""

if "Boundary from winners.json" in src:
    print("skip: weekly boundary wiring")
elif src.count(old) != 1:
    sys.exit(f"weekly call site: {src.count(old)} matches")
else:
    open(LD, "w").write(src.replace(old, new, 1))
    print("ok: weekly boundary wiring")

# ── 4. say so on the Verify page ───────────────────────────────────────────
SN = "round-snapshot.js"
snap = open(SN).read()
old = '''            "than let it hide inside one undifferentiated list."'''
new = '''            "than let it hide inside one undifferentiated list.",
            "",
            "One more weekly caveat: which NFTs are still unplayed is read from the",
            "previous completed weekly entry in winners.json (boundary_ts / deadline),",
            "not derived from the chain. It cannot be derived - a weekly round can go",
            "ahead on free entries alone, or be called off because the pool sat below",
            "its minimum, and neither fact is on-chain. For daily, the same boundary IS",
            "derived from the chain and needs no file at all."'''

if "One more weekly caveat" in snap:
    print("skip: verify text")
elif snap.count(old) != 1:
    sys.exit(f"verify anchor: {snap.count(old)} matches")
else:
    open(SN, "w").write(snap.replace(old, new, 1))
    print("ok: verify text")
