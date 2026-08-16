#!/usr/bin/env python3
"""Wire chain-tickets.js into runDailyDraw + update the public verification text.

Writes after every step, so a later failure never silently discards earlier work.
Each step is skipped if already applied, so re-running is safe.
"""
import re
import sys

LD = "lottery-draw.js"
SN = "round-snapshot.js"

NFT = "terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx"


def write(path, text):
    open(path, "w").write(text)


# ── lottery-draw.js ─────────────────────────────────────────────────────────
src = open(LD).read()

# 1. import
if "buildTicketsFromChain" in src:
    print("skip: import")
else:
    imports = list(re.finditer(r"^import .+?;\s*$", src, re.M))
    if not imports:
        sys.exit("no top-level import found in lottery-draw.js")
    at = imports[-1].end()
    src = src[:at] + "\nimport { buildTicketsFromChain } from './chain-tickets.js';" + src[at:]
    write(LD, src)
    print("ok: import")

# 2. ticket source
old = """  console.log('Fetching participants from Worker /round-stats...');
  const participants = await fetchParticipants('daily');
  const tickets = buildTickets(participants);
  console.log('Participants: ' + Object.keys(participants).length + ', Tickets: ' + tickets.length);"""
new = """  // Билеты строятся из NFT-контракта, а не из воркера. Правило описано в
  // chain-tickets.js: жёсткая отсечка minted_at < deadline, порядок по
  // (minted_at, token_id), владелец на высоте блока дедлайна. Любой может
  // собрать тот же список сам и проверить winner_index.
  const deadlineMs = getDrawDeadlineTs();

  // Блок нужен ДО билетов: на его высоте читаются владельцы, иначе перевод
  // NFT между дедлайном и запуском розыгрыша уводил бы приз.
  const blockInfo = await getRoundBlockInfo();

  console.log('Building tickets from the NFT contract...');
  const { tickets, tokens, boundaryTs } = await buildTicketsFromChain({
    pool: 'daily',
    deadlineMs,
    blockHeight: blockInfo.height,
  });
  const participantCount = new Set(tokens.map(function (t) { return t.owner; })).size;
  console.log('Deadline: ' + new Date(deadlineMs).toISOString() +
              ', unconsumed since: ' + new Date(boundaryTs * 1000).toISOString());
  console.log('Participants: ' + participantCount + ', Tickets: ' + tickets.length);"""

if "Building tickets from the NFT contract" in src:
    print("skip: ticket source")
elif src.count(old) != 1:
    sys.exit(f"ticket-source anchor: {src.count(old)} matches, expected 1")
else:
    src = src.replace(old, new, 1)
    write(LD, src)
    print("ok: ticket source")

# 3. blockInfo already fetched above
old = """  // Select winner
  const blockInfo = await getRoundBlockInfo();
  const blockHash = blockInfo.hash;"""
new = """  // Select winner (blockInfo fetched above, before the tickets)
  const blockHash = blockInfo.hash;"""
if "blockInfo fetched above" in src:
    print("skip: blockInfo dedupe")
elif src.count(old) != 1:
    sys.exit(f"blockInfo anchor: {src.count(old)} matches, expected 1")
else:
    src = src.replace(old, new, 1)
    write(LD, src)
    print("ok: blockInfo dedupe")

# 4. daily winners record - FIRST global match, because runDailyDraw comes
#    before runWeeklyDraw. (The skip branch has no `participants:` line at all,
#    so anchoring on winners.daily.push would land in the wrong record.)
old = """    entries:     tickets.length,
    participants: Object.keys(participants).length,"""
new = f"""    entries:     tickets.length,
    participants: participantCount,
    ticket_rule:  'chain-v1',
    nft_contract: '{NFT}',
    deadline:     new Date(deadlineMs).toISOString(),
    boundary_ts:  boundaryTs,"""
if "ticket_rule" in src:
    print("skip: winners record")
elif src.count(old) < 1:
    sys.exit("winners-record anchor not found")
else:
    print(f"note: {src.count(old)} matches, patching the first (daily)")
    src = src.replace(old, new, 1)
    write(LD, src)
    print("ok: winners record")

# ── round-snapshot.js ───────────────────────────────────────────────────────
snap = open(SN).read()
if "ticket_rule chain-v1" in snap:
    print("skip: verification text")
    sys.exit(0)

anchor = '"That makes the result independent of when the script actually ran."'
if snap.count(anchor) != 1:
    sys.exit("verification-text anchor not found")

added = anchor + """,
            "",
            "Where the entry list itself comes from (daily, ticket_rule chain-v1):",
            "Minting an NFT is entering the draw, so the list follows from the NFT",
            "contract alone - no server is involved and nothing has to be trusted:",
            "  contract: """ + NFT + """",
            "  a. take tokens with extension.pool = 'daily' and minted_at < deadline",
            "  b. drop those consumed by an earlier draw - a round with fewer than 5",
            "     entries is skipped and consumes nothing, so its tokens roll over",
            "  c. order by (minted_at, token_id), token_id compared as a string",
            "  d. repeat each token extension.entries times",
            "  e. read the owner at block_height, so transferring an NFT after the",
            "     deadline cannot move the prize",
            "",
            "Weekly also adds free entries from free-entries.json, earned off-chain -",
            "that part cannot be rebuilt from the chain yet." """.rstrip()

snap = snap.replace(anchor, added, 1)
write(SN, snap)
print("ok: verification text")
