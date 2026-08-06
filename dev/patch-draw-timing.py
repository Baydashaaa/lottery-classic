#!/usr/bin/env python3
"""Cut the hour between the deadline and the published result.

Measured gap: 56-73 minutes, and almost none of it is the draw itself — it is
GitHub deciding when to start the job. A cron at 20:00 routinely fires at 20:40.

So start the job at 19:30 and let it wait for the deadline on chain. Whatever
delay GitHub adds is absorbed by the wait instead of being added to it, and the
draw fires within seconds of 20:00. Idle minutes on a public repo are free.

Run from ~/oracle-draw.
"""
import re
import sys

# ── 1. wait for the deadline instead of failing on it ──────────────────────
P = "lottery-draw.js"
s = open(P).read()

if "waitForDeadline" in s:
    print("skip: waitForDeadline")
else:
    m = re.search(r"\nasync function getRoundBlockInfo\(\) \{", s)
    if not m:
        sys.exit("could not find getRoundBlockInfo")

    helper = '''
// Ждём дедлайн, а не отказываемся из-за него.
//
// Джоб запускается заранее (cron 19:30), потому что GitHub стартует когда
// захочет — наблюдались задержки до 40 минут. Раньше эта задержка целиком
// прибавлялась к времени публикации результата; теперь она съедается
// ожиданием, и розыгрыш происходит через секунды после 20:00.
//
// Ждём по времени цепи, а не по часам раннера: дедлайн определён в терминах
// блоков, и только это время имеет значение.
async function waitForDeadline(deadlineMs, maxWaitMs) {
  const started = Date.now();
  for (;;) {
    const latest = await fetchBlock('latest');
    if (latest && latest.timeMs >= deadlineMs) {
      console.log('Deadline reached, chain time ' + new Date(latest.timeMs).toISOString());
      return true;
    }
    if (Date.now() - started > maxWaitMs) {
      console.warn('Waited ' + Math.round(maxWaitMs / 60000) + 'm and the deadline is still ahead — giving up');
      return false;
    }
    const left = latest ? Math.round((deadlineMs - latest.timeMs) / 1000) : '?';
    console.log('Waiting for the deadline, ' + left + 's to go...');
    await new Promise(r => setTimeout(r, 10000));
  }
}
'''
    s = s[: m.start()] + helper + s[m.start():]
    open(P, "w").write(s)
    print("ok: waitForDeadline added")

# ── 2. call it before resolving the block ──────────────────────────────────
s = open(P).read()
if "await waitForDeadline(" in s:
    print("skip: wait call")
else:
    old = """  const deadline = getDrawDeadlineTs();
  console.log('Round deadline (UTC): ' + new Date(deadline).toISOString());"""
    new = """  const deadline = getDrawDeadlineTs();
  console.log('Round deadline (UTC): ' + new Date(deadline).toISOString());
  // До 45 минут — с запасом на самый поздний старт, что мы видели.
  await waitForDeadline(deadline, 45 * 60 * 1000);"""
    if s.count(old) != 1:
        sys.exit(f"deadline log anchor: {s.count(old)} matches")
    open(P, "w").write(s.replace(old, new, 1))
    print("ok: wait call")

# ── 3. cron earlier ────────────────────────────────────────────────────────
P = "  .github/workflows/lottery-draw.yml".strip()
w = open(P).read()
old = "    - cron: '0 20 * * *'"
new = ("    # 19:30, не 20:00: GitHub стартует джоб с задержкой до 40 минут, а\n"
       "    # скрипт сам дожидается дедлайна по времени цепи. Так задержка\n"
       "    # поглощается ожиданием вместо того, чтобы прибавляться к нему.\n"
       "    - cron: '30 19 * * *'")
if "30 19 * * *" in w:
    print("skip: cron")
elif w.count(old) != 1:
    sys.exit(f"cron anchor: {w.count(old)} matches")
else:
    open(P, "w").write(w.replace(old, new, 1))
    print("ok: cron moved to 19:30")

print("\nExpect the result live around 20:03-20:05 instead of 21:00.")
