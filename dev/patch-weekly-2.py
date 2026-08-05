#!/usr/bin/env python3
"""Weekly draw, part 2. Locates the block by line markers instead of exact text."""
import sys

P = "lottery-draw.js"
NFT = "terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx"


def save(lines):
    open(P, "w").write("\n".join(lines))


lines = open(P).read().split("\n")

# ── 2. weekly ticket source, by line markers ───────────────────────────────
if any("Building NFT tickets from the contract" in l for l in lines):
    print("skip: weekly ticket source")
else:
    start = next((i for i, l in enumerate(lines)
                  if "fetchParticipants('weekly')" in l), None)
    if start is None:
        sys.exit("could not find fetchParticipants('weekly')")
    # walk back over the console.log that introduces it
    while start > 0 and "console.log" in lines[start - 1] and "Fetching" in lines[start - 1]:
        start -= 1
    end = next((i for i in range(start, min(start + 12, len(lines)))
                if "Tickets: ' + tickets.length" in lines[i]), None)
    if end is None:
        sys.exit("could not find the tickets console.log after it")

    print("replacing lines %d–%d:" % (start + 1, end + 1))
    for l in lines[start:end + 1]:
        print("   |", l)

    block = """  // Weekly состоит из двух блоков, и порядок между ними зафиксирован:
  //   1) NFT-билеты из контракта — то же правило, что в daily
  //   2) бесплатные входы из free-entries.json, по возрастанию адреса
  // NFT-часть проверяется по цепи целиком; бесплатная — только по истории
  // коммитов free-entries.json, и об этом честно сказано на странице проверки.
  const deadlineMs = getDrawDeadlineTs();
  const blockInfo = await getRoundBlockInfo();

  console.log('Building NFT tickets from the contract...');
  const { tickets: nftTickets, tokens, boundaryTs } = await buildTicketsFromChain({
    pool: 'weekly',
    deadlineMs,
    blockHeight: blockInfo.height,
  });
  const freeTickets = buildFreeTickets();
  const tickets = nftTickets.concat(freeTickets);
  const uniqueAddrs = new Set(tickets);

  console.log('Deadline: ' + new Date(deadlineMs).toISOString() +
              ', unconsumed since: ' + new Date(boundaryTs * 1000).toISOString());
  console.log('NFT tickets: ' + nftTickets.length + ' from ' + tokens.length + ' token(s)' +
              ', free entries: ' + freeTickets.length);
  console.log('Participants: ' + uniqueAddrs.size + ', Tickets: ' + tickets.length);""".split("\n")

    lines = lines[:start] + block + lines[end + 1:]
    save(lines)
    print("ok: weekly ticket source")

src = open(P).read()


def swap(old, new, label, marker):
    global src
    if marker in src:
        print("skip:", label)
        return
    if src.count(old) != 1:
        sys.exit(f"{label}: {src.count(old)} matches, expected 1")
    src = src.replace(old, new, 1)
    open(P, "w").write(src)
    print("ok:", label)


# ── 3. participant count ───────────────────────────────────────────────────
swap("  const uniqueParticipants = Object.keys(participants).length;",
     "  const uniqueParticipants = uniqueAddrs.size;",
     "participant count", "uniqueParticipants = uniqueAddrs.size")

# ── 4. blockInfo already fetched above ─────────────────────────────────────
swap("""  const blockInfo = await getRoundBlockInfo();
  const blockHash = blockInfo.hash;
  const blockHeight = blockInfo.height;
  console.log('Block height: ' + blockHeight + ', hash: ' + blockHash);
  const places = [];""",
     """  const blockHash = blockInfo.hash;   // fetched above, before the tickets
  const blockHeight = blockInfo.height;
  console.log('Block height: ' + blockHeight + ', hash: ' + blockHash);
  const places = [];""",
     "weekly blockInfo dedupe", "fetched above, before the tickets")

# ── 5. successful weekly record ────────────────────────────────────────────
swap("""    entries:     tickets.length,
    participants: Object.keys(participants).length,""",
     f"""    entries:     tickets.length,
    participants: uniqueAddrs.size,
    ticket_rule:  'chain-v1+free',
    nft_contract: '{NFT}',
    deadline:     new Date(deadlineMs).toISOString(),
    boundary_ts:  boundaryTs,
    nft_tickets:  nftTickets.length,
    free_tickets: freeTickets.length,""",
     "weekly winners record", "'chain-v1+free'")

# ── 6. dates follow the deadline, not the run time ─────────────────────────
a = src.index("async function runWeeklyDraw")
region = src[a:]
n = region.count("new Date().toISOString().slice(0, 10)")
if n == 0:
    print("skip: weekly dates")
else:
    src = src[:a] + region.replace("new Date().toISOString().slice(0, 10)",
                                   "new Date(deadlineMs).toISOString().slice(0, 10)")
    open(P, "w").write(src)
    print(f"ok: weekly dates ({n})")
