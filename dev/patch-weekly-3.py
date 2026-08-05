#!/usr/bin/env python3
"""1) spell out the weekly ordering on the public Verify page
   2) allow overriding the deadline under DRY_RUN so weekly can be tested
      before Monday"""
import sys

# ── 1. public verification text ────────────────────────────────────────────
S = "round-snapshot.js"
snap = open(S).read()

old = '''            "Weekly also adds free entries from free-entries.json, earned off-chain —",
            "that part cannot be rebuilt from the chain yet."'''
new = '''            "",
            "Weekly (ticket_rule chain-v1+free) is built from two blocks, in this order:",
            "  1. NFT tickets, exactly by the daily rule above but with pool = 'weekly'.",
            "     Their count is recorded as nft_tickets in winners.json.",
            "  2. Free entries from free-entries.json, wallets in ascending string order,",
            "     each repeated by its `total`. Count recorded as free_tickets.",
            "Block 1 can be rebuilt from the chain and checked against nft_tickets.",
            "Block 2 cannot: free entries are earned by chatting and asking questions,",
            "which happens off-chain. What you can check there is the commit history of",
            "free-entries.json in this repository. We would rather point at that limit",
            "than let it hide inside one undifferentiated list."'''

if "chain-v1+free" in snap:
    print("skip: verification text")
elif snap.count(old) != 1:
    sys.exit(f"verification anchor: {snap.count(old)} matches, expected 1")
else:
    open(S, "w").write(snap.replace(old, new, 1))
    print("ok: verification text")

# ── 2. deadline override, DRY_RUN only ─────────────────────────────────────
P = "lottery-draw.js"
src = open(P).read()

old = """function getDrawDeadlineTs() {"""
new = """function getDrawDeadlineTs() {
  // Только для холостых прогонов: боевой путь никогда сюда не заходит,
  // потому что DRY_RUN запрещает любую отправку средств.
  if (process.env.DRY_RUN === '1' && process.env.DRY_RUN_DEADLINE) {
    const forced = new Date(process.env.DRY_RUN_DEADLINE).getTime();
    if (!Number.isFinite(forced)) throw new Error('DRY_RUN_DEADLINE is not a valid date');
    console.warn('DRY_RUN: deadline forced to ' + new Date(forced).toISOString());
    return forced;
  }"""

if "DRY_RUN_DEADLINE" in src:
    print("skip: deadline override")
elif src.count(old) != 1:
    sys.exit(f"getDrawDeadlineTs anchor: {src.count(old)} matches, expected 1")
else:
    open(P, "w").write(src.replace(old, new, 1))
    print("ok: deadline override")
