#!/usr/bin/env python3
"""Pay an explicit fee instead of relying on cosmjs's gasPrice option.

`SigningCosmWasmClient` checks `gasPrice instanceof GasPrice`, and that check
fails whenever the GasPrice class we import is not the exact same class object
the client holds - which npm's dependency resolution decides for us. Pinning
versions did not settle it.

An explicit StdFee sidesteps the whole question: no class identity, no shared
package instance, nothing for a future install to break. The cost is that gas
is fixed rather than simulated, so the script logs what was actually used and
the limits can be tuned down once there is real data.

Run from ~/oracle-draw.
"""
import sys

P = ".github/scripts/pool-keeper.js"
s = open(P).read()

if "GAS_LIMITS" in s:
    sys.exit("already patched")

# ── drop the gasPrice option ───────────────────────────────────────────────
old = """  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet, {
    gasPrice: GasPrice.fromString(GAS_PRICE),
  });"""
new = """  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet);"""
if s.count(old) != 1:
    old = """  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet, {
    gasPrice: GasPrice.fromString(GAS_PRICE),
    chainId: CHAIN_ID,
  });"""
    new = """  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet);"""
    if s.count(old) != 1:
        sys.exit("could not find the client construction")
s = s.replace(old, new, 1)

# ── the import is no longer needed ─────────────────────────────────────────
s = s.replace("import { GasPrice } from '@cosmjs/stargate';\n", "")

# ── fee constants + helper ─────────────────────────────────────────────────
old = "const GAS_PRICE = '28.325uluna';"
new = """const GAS_PRICE_ULUNA = 28.325;

/**
 * Fixed gas limits. Generous on purpose: an under-estimated draw would revert
 * after doing all its work, and the round would sit unsettled until someone
 * noticed. The script prints gasUsed so these can be trimmed later.
 */
const GAS_LIMITS = { open: 400_000, settle: 1_500_000 };

function feeFor(kind) {
  const gas = GAS_LIMITS[kind];
  return {
    amount: [{ denom: DENOM, amount: String(Math.ceil(gas * GAS_PRICE_ULUNA)) }],
    gas: String(gas),
  };
}"""
if s.count(old) != 1:
    sys.exit("could not find GAS_PRICE")
s = s.replace(old, new, 1)

# ── use it at both call sites ──────────────────────────────────────────────
s = s.replace(
    """    { open_round: { seed_hash: seedHash, close_time: String(closeTime * 1_000_000) } },
    'auto',""",
    """    { open_round: { seed_hash: seedHash, close_time: String(closeTime * 1_000_000) } },
    feeFor('open'),""",
    1,
)
s = s.replace(
    """    { execute_draw: { round_id: id, secret } },
    'auto',""",
    """    { execute_draw: { round_id: id, secret } },
    feeFor('settle'),""",
    1,
)

if "'auto'," in s:
    sys.exit("a call site still uses 'auto' - check the file")

# ── log what the gas actually cost, so the limits can be tuned ─────────────
s = s.replace(
    "  console.log(`[${pool}] opened, tx ${res.transactionHash}`);",
    "  console.log(`[${pool}] opened, tx ${res.transactionHash}, gas used ${res.gasUsed}/${GAS_LIMITS.open}`);",
    1,
)
s = s.replace(
    "    console.log(`[${pool}] settled, tx ${res.transactionHash}`);",
    "    console.log(`[${pool}] settled, tx ${res.transactionHash}, gas used ${res.gasUsed}/${GAS_LIMITS.settle}`);",
    1,
)

open(P, "w").write(s)
print("ok: explicit fee, no gasPrice option")
