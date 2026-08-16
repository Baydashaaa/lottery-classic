#!/usr/bin/env python3
"""Replay every daily round from chain data alone and compare with winners.json.

READ-ONLY. Touches nothing, signs nothing.

The question it answers: is the NFT contract enough to rebuild the ticket list,
without asking the Worker? If the entry counts line up with what winners.json
recorded, then the draw can be made verifiable end to end.

Rule under test:
    a token enters the first draw of its pool after minted_at;
    a round with fewer than MIN_ENTRIES tickets is skipped and consumes nothing;
    tickets are ordered by (minted_at, token_id) and repeated `entries` times.

Winner indexes are NOT compared: today the order comes from the Worker's
per-wallet grouping, so historical indexes cannot match by construction.
"""
import base64
import datetime as dt
import json
import sys
import subprocess
import urllib.request

NFT = "terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx"
LCDS = [
    "https://terra-classic-lcd.publicnode.com",
    "https://lcd-terra-classic.hexxagon.io",
]
MIN_ENTRIES = 5
CONSUMED_BEFORE = 1784837749  # 2026-07-23 20:15 UTC - everything up to here went into the 07-23 draw
POOL = "daily"


def query(msg: dict) -> dict:
    q = base64.b64encode(json.dumps(msg).encode()).decode()
    last = None
    for base in LCDS:
        url = f"{base}/cosmwasm/wasm/v1/contract/{NFT}/smart/{q}"
        try:
            out = subprocess.run(["curl", "-sS", "--max-time", "15", url],
                                 capture_output=True, text=True, check=True)
            return json.loads(out.stdout)["data"]
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"query failed on every LCD: {last}")


def all_tokens() -> list:
    out, start = [], None
    while True:
        msg = {"all_tokens": {"limit": 30}}
        if start:
            msg["all_tokens"]["start_after"] = start
        batch = query(msg)["tokens"]
        if not batch:
            break
        out += batch
        start = batch[-1]
        if len(batch) < 30:
            break
    return out


def load_tokens() -> list:
    ids = all_tokens()
    print(f"tokens on chain: {len(ids)}")
    rows = []
    for tid in ids:
        info = query({"all_nft_info": {"token_id": tid}})
        ext = info["info"]["extension"] or {}
        rows.append({
            "id": tid,
            "owner": info["access"]["owner"],
            "pool": ext.get("pool"),
            "entries": int(ext.get("entries") or 0),
            "minted_at": int(ext.get("minted_at") or 0),
            "tier": ext.get("tier"),
        })
    return rows


def daily_deadlines(first_ts: int, now_ts: int):
    """20:00 UTC every day except Monday, which belongs to the weekly draw."""
    d = dt.datetime.fromtimestamp(first_ts, dt.timezone.utc).replace(
        hour=20, minute=0, second=0, microsecond=0
    )
    if d.timestamp() <= first_ts:
        d += dt.timedelta(days=1)
    while d.timestamp() <= now_ts:
        if d.isoweekday() != 1:
            yield d
        d += dt.timedelta(days=1)


def main():
    tokens = [t for t in load_tokens() if t["pool"] == POOL and t["minted_at"] >= CONSUMED_BEFORE]
    if not tokens:
        sys.exit("no tokens in this pool")
    tokens.sort(key=lambda t: (t["minted_at"], t["id"]))

    try:
        winners = json.load(open("winners.json"))[POOL]
    except Exception as e:  # noqa: BLE001
        print(f"(winners.json unavailable: {e}) - replaying without comparison")
        winners = []
    by_date = {w.get("date"): w for w in winners}

    first = tokens[0]["minted_at"]
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    pending, mismatches = [], 0

    print(f"\nreplaying {POOL} from {dt.datetime.fromtimestamp(first, dt.timezone.utc).date()}\n")
    print(f"{'date':<12}{'entries':>8}{'wallets':>9}  {'recorded':>9}  verdict")
    print("-" * 60)

    idx = 0
    for deadline in daily_deadlines(first, now):
        ts = int(deadline.timestamp())
        while idx < len(tokens) and tokens[idx]["minted_at"] < ts:
            pending.append(tokens[idx])
            idx += 1

        entries = sum(t["entries"] for t in pending)
        wallets = len({t["owner"] for t in pending})
        date = deadline.date().isoformat()
        rec = by_date.get(date)
        recorded = "-" if not rec else str(rec.get("entries", "?"))

        if entries < MIN_ENTRIES:
            verdict = "skipped"
        else:
            verdict = "DRAW"
            pending = []

        if rec is not None:
            if str(entries) == recorded:
                verdict += "  match"
            else:
                verdict += "  MISMATCH"
                mismatches += 1

        print(f"{date:<12}{entries:>8}{wallets:>9}  {recorded:>9}  {verdict}")

    print("-" * 60)
    print(f"unconsumed tickets right now: {sum(t['entries'] for t in pending)}")
    print(f"rounds compared with mismatches: {mismatches}")
    print("\nNOTE: `wallets` uses CURRENT owners, not owners at the deadline block.")
    print("Historical rounds can differ if an NFT changed hands afterwards.")


if __name__ == "__main__":
    main()
