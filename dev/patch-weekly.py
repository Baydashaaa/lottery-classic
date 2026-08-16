#!/usr/bin/env python3
"""Weekly draw: NFT tickets from the contract + free entries in a published order.

Writes after every step. Re-running is safe - each step checks itself.
"""
import sys

P = "lottery-draw.js"
NFT = "terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx"


def save(s):
    open(P, "w").write(s)


src = open(P).read()

# ── 1. helper: free entries as an ordered ticket list ───────────────────────
if "function buildFreeTickets" in src:
    print("skip: buildFreeTickets")
else:
    anchor = "// ── Build ticket array ───"
    i = src.find(anchor)
    if i == -1:
        sys.exit("could not find the build-ticket-array section")
    helper = """// Бесплатные входы как упорядоченный список билетов.
// Порядок - по адресу кошелька, а не по порядку ключей в JSON: только так
// проверяющий соберёт тот же массив, что и мы.
function buildFreeTickets() {
  if (!fs.existsSync(FREE_ENTRIES_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FREE_ENTRIES_PATH, 'utf8'));
    const entries = data.entries || {};
    const out = [];
    for (const wallet of Object.keys(entries).sort()) {
      const total = (entries[wallet] && entries[wallet].total) || 0;
      for (let i = 0; i < total; i++) out.push(wallet);
    }
    return out;
  } catch (e) {
    console.warn('Could not load free-entries.json:', e.message);
    return [];
  }
}

"""
    src = src[:i] + helper + src[i:]
    save(src)
    print("ok: buildFreeTickets")

# ── 2. weekly ticket source ────────────────────────────────────────────────
old = """  console.log('Fetching paid participants from Worker /round-stats...');
  let participants = await fetchParticipants('weekly');
  console.log('Adding free entries from free-entries.json...');
  participants = addFreeEntries(participants);
  const tickets = buildTickets(participants);
  console.log('Participants: ' + Object.keys(participants).length + ', Tickets: ' + tickets.length);"""
new = """  // Weekly состоит из двух блоков, и порядок между ними зафиксирован:
  //   1) NFT-билеты из контракта - то же правило, что в daily
  //   2) бесплатные входы из free-entries.json, по возрастанию адреса
  // NFT-часть проверяется по цепи целиком; бесплатная - только по истории
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
  console.log('Participants: ' + uniqueAddrs.size + ', Tickets: ' + tickets.length);"""

if "Building NFT tickets from the contract" in src:
    print("skip: weekly ticket source")
elif src.count(old) != 1:
    sys.exit(f"weekly ticket anchor: {src.count(old)} matches, expected 1")
else:
    src = src.replace(old, new, 1)
    save(src)
    print("ok: weekly ticket source")

# ── 3. participant count ───────────────────────────────────────────────────
old = "  const uniqueParticipants = Object.keys(participants).length;"
new = "  const uniqueParticipants = uniqueAddrs.size;"
if "uniqueParticipants = uniqueAddrs.size" in src:
    print("skip: participant count")
elif src.count(old) != 1:
    sys.exit(f"uniqueParticipants anchor: {src.count(old)} matches, expected 1")
else:
    src = src.replace(old, new, 1)
    save(src)
    print("ok: participant count")

# ── 4. blockInfo already fetched above ─────────────────────────────────────
old = """  const blockInfo = await getRoundBlockInfo();
  const blockHash = blockInfo.hash;
  const blockHeight = blockInfo.height;
  console.log('Block height: ' + blockHeight + ', hash: ' + blockHash);
  const places = [];"""
new = """  const blockHash = blockInfo.hash;   // fetched above, before the tickets
  const blockHeight = blockInfo.height;
  console.log('Block height: ' + blockHeight + ', hash: ' + blockHash);
  const places = [];"""
if "fetched above, before the tickets" in src:
    print("skip: weekly blockInfo dedupe")
elif src.count(old) != 1:
    sys.exit(f"weekly blockInfo anchor: {src.count(old)} matches, expected 1")
else:
    src = src.replace(old, new, 1)
    save(src)
    print("ok: weekly blockInfo dedupe")

# ── 5. dates in the weekly records follow the deadline, not the run time ───
a = src.index("async function runWeeklyDraw")
region = src[a:]
n = region.count("new Date().toISOString().slice(0, 10)")
if n == 0:
    print("skip: weekly dates")
else:
    src = src[:a] + region.replace(
        "new Date().toISOString().slice(0, 10)",
        "new Date(deadlineMs).toISOString().slice(0, 10)",
    )
    save(src)
    print(f"ok: weekly dates ({n})")

print("\ndone - the successful-draw record still needs ticket_rule fields, see below")
