#!/usr/bin/env python3
"""Explicit fee instead of cosmjs's gasPrice option — structural version.

The first attempt matched exact strings and one of them had drifted. This one
finds the client.execute(...) calls by their contents, so formatting does not
matter.

Run from ~/oracle-draw.
"""
import re
import sys

P = ".github/scripts/pool-keeper.js"
s = open(P).read()

if "GAS_LIMITS" in s:
    sys.exit("already patched")

# ── 1. client without gasPrice ─────────────────────────────────────────────
m = re.search(
    r"const client = await SigningCosmWasmClient\.connectWithSigner\(RPC, wallet[^;]*\);",
    s,
    re.S,
)
if not m:
    sys.exit("could not find the client construction")
s = s[: m.start()] + "const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet);" + s[m.end():]
print("ok: client")

s = s.replace("import { GasPrice } from '@cosmjs/stargate';\n", "")

# ── 2. constants ───────────────────────────────────────────────────────────
m = re.search(r"const GAS_PRICE\s*=\s*'[^']*';", s)
if not m:
    sys.exit("could not find GAS_PRICE")
block = """const GAS_PRICE_ULUNA = 28.325;

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
}"""
s = s[: m.start()] + block + s[m.end():]
print("ok: constants")

# ── 3. every execute() call, by what it sends ──────────────────────────────
count = 0
for kind, needle in (("open", "open_round"), ("settle", "execute_draw")):
    for m in re.finditer(r"client\.execute\(", s):
        start = m.start()
        depth = 0
        end = None
        for i in range(s.index("(", start), len(s)):
            if s[i] == "(":
                depth += 1
            elif s[i] == ")":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end is None:
            sys.exit("unbalanced parentheses in a client.execute call")
        call = s[start:end]
        if needle not in call or "'auto'" not in call:
            continue
        s = s[:start] + call.replace("'auto'", f"feeFor('{kind}')", 1) + s[end:]
        count += 1
        break
if count != 2:
    sys.exit(f"patched {count} call sites, expected 2 — show me the execute() blocks")
print("ok: both call sites")

if "'auto'" in s:
    sys.exit("something still uses 'auto'")

# ── 4. log the real gas so the limits can be tuned ─────────────────────────
s = s.replace(
    "opened, tx ${res.transactionHash}`",
    "opened, tx ${res.transactionHash}, gas ${res.gasUsed}/${GAS_LIMITS.open}`",
)
s = s.replace(
    "settled, tx ${res.transactionHash}`",
    "settled, tx ${res.transactionHash}, gas ${res.gasUsed}/${GAS_LIMITS.settle}`",
)

open(P, "w").write(s)
print("\nwritten — node --check next")
