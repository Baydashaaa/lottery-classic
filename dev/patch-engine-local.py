#!/usr/bin/env python3
"""Spin the wheel on a locally computed result, then reconcile out loud.

The winner is fixed by the deadline block at 20:00. Everything after that is
just somebody writing it down — a workflow starting, transactions confirming, a
page rebuilding. The browser needs none of that: it can read the block and the
NFT contract itself and know the answer within seconds.

Two things this must not do, and both are easy to get wrong:

  * It must not replace the round in state. #adoptLatest exits early when the
    incoming key equals state.roundKey, so writing the local result there would
    make the published snapshot look like a duplicate and silently drop it —
    losing the reconciliation entirely.
  * It must not let the wheel spin twice. When the published file arrives and
    agrees, the result is already on screen: adopt it quietly. Only a
    disagreement gets a second spin, and a warning with it, because a
    disagreement means the browser and the draw script no longer share a rule.

Run from ~/oracle-draw.
"""
import sys

P = "assets/js/draw-v2/DrawEngine.js"
s = open(P).read()

if "#tryLocalResult" in s:
    sys.exit("already patched")

# ── import ─────────────────────────────────────────────────────────────────
lines = s.split("\n")
last_import = max(i for i, l in enumerate(lines) if l.startswith("import "))
lines.insert(last_import + 1,
    "// The same module lottery-draw.js uses. Deliberately not a second copy of\n"
    "// the rule: two copies drift, and a drifted rule shows one winner while\n"
    "// paying another.\n"
    "import { buildLocalSnapshot } from \"../../../chain-tickets.js\";")
s = "\n".join(lines)
print("ok: import")

# ── trigger on entering AWAITING ───────────────────────────────────────────
old = """        if (phase !== this.state.phase) {
            const from = this.state.phase;
            this.state.phase = phase;
            this.events.emit(EVENTS.PHASE_CHANGED, { from, to: phase, pool: this.state.pool });
        }"""
new = """        if (phase !== this.state.phase) {
            const from = this.state.phase;
            this.state.phase = phase;
            this.events.emit(EVENTS.PHASE_CHANGED, { from, to: phase, pool: this.state.pool });
        }
        // Waiting for a result we can work out ourselves. Fire and forget: a
        // failure here costs nothing, the published file still arrives.
        if (phase === PHASE.AWAITING) this.#tryLocalResult(now);"""
if s.count(old) != 1:
    sys.exit(f"syncPhase anchor: {s.count(old)} matches")
s = s.replace(old, new, 1)
print("ok: trigger")

# ── the local path + reconciliation ────────────────────────────────────────
anchor = "    /* ---------- приём нового раунда ---------- */"
if s.count(anchor) != 1:
    sys.exit("could not find the adopt section")

block = '''    /* ---------- локальный расчёт ---------- */

    /**
     * Работает результат сам, не дожидаясь публикации.
     *
     * Кладём его в this.local, а НЕ в state: #adoptLatest выходит рано, если
     * ключ совпал с текущим, и опубликованный снимок был бы отброшен молча.
     * Сверка с ним — единственное, что доказывает, что правило не разъехалось.
     */
    async #tryLocalResult(now = Date.now()) {
        if (this.localBusy) return;
        const pool = this.state.pool;
        const deadline = prevDeadline(pool, now);
        if (!deadline) return;

        const date = new Date(deadline).toISOString().slice(0, 10);
        const key = `${pool}_${date}`;
        if (this.local && this.local.key === key) return;
        if (this.state.roundKey === key) return;   // опубликованный уже пришёл

        this.localBusy = true;
        try {
            // Граница «отыграно» — дедлайн последнего состоявшегося раунда,
            // ровно как её берёт lottery-draw.js.
            const done = (this.data[pool] || []).filter(r => !r.skipped && r.date);
            const prev = done[done.length - 1] || null;
            const boundaryTs = prev
                ? Math.floor(Date.parse(prev.date + "T20:00:00Z") / 1000)
                : undefined;

            const r = await buildLocalSnapshot({ pool, deadlineMs: deadline, roundId: key, boundaryTs });
            if (!r || r.skipped) { this.local = { key, skipped: true }; return; }
            if (this.state.roundKey === key) return;   // пока считали, приехал настоящий

            const model = new TicketModel(r.snapshot, { maxSectors: CONFIG.MAX_SECTORS });
            const round = {
                key, pool, date,
                skipped: false, reason: null,
                winner: r.winner, winnerIndex: r.index, prize: 0,
                winners: [{ place: 1, address: r.winner, prize: 0, tx: null, index: r.index }],
                entries: r.snapshot.total, participants: r.snapshot.wallets,
                blockHash: r.block.hash, blockHeight: String(r.block.height),
                randomness: "terra-classic-block-hash-at-round-deadline",
                txTreasury: null, drawnAt: deadline, raw: r.snapshot, local: true
            };
            this.local = { key, round, model, winner: r.winner, index: r.index };

            // Раунд считается просмотренным сразу: перезагрузка страницы не
            // должна крутить колесо повторно.
            this.state.markSeen(key);
            this.events.emit(EVENTS.RESULT_READY, { round, firstLoad: false, model, verified: true });
            this.events.emit(EVENTS.DRAW_FINISHED, { round, model, replay: false });
        } catch (e) {
            console.warn("[DrawEngine] локальный расчёт не удался:", e.message);
        } finally {
            this.localBusy = false;
        }
    }

    /**
     * Сверка опубликованного результата с тем, что уже показано.
     * Совпало — тишина. Разошлось — говорим громко: это значит, что правило в
     * браузере и правило в скрипте больше не одно и то же.
     */
    #reconcileLocal(latest) {
        const loc = this.local;
        if (!loc || loc.key !== latest.key || loc.skipped) return false;
        const same = loc.winner === latest.winner && loc.index === latest.winnerIndex;
        if (!same) {
            console.error(
                `[DrawEngine] локальный результат разошёлся с опубликованным для ${latest.key}: ` +
                `показали ${loc.winner} (index ${loc.index}), в winners.json ${latest.winner} ` +
                `(index ${latest.winnerIndex}). Победитель — опубликованный.`
            );
        }
        return same;
    }

''' + anchor

s = s.replace(anchor, block, 1)
print("ok: local path")

# ── use it in #adoptLatest ─────────────────────────────────────────────────
old = """        const seen = this.state.hasSeen(latest.key);"""
new = """        // Уже показали этот раунд из локального расчёта? Тогда крутить второй
        // раз незачем — если только он не разошёлся с опубликованным.
        const agreed = this.#reconcileLocal(latest);
        if (agreed) {
            this.state.markSeen(latest.key);
            if (firstLoad) this.events.emit(EVENTS.READY, this.snapshot());
            return;
        }

        const seen = this.state.hasSeen(latest.key);"""
if s.count(old) != 1:
    sys.exit(f"adopt anchor: {s.count(old)} matches")
s = s.replace(old, new, 1)
print("ok: reconciliation wired")

open(P, "w").write(s)
print("\nCheck that prevDeadline, PHASE, TicketModel and CONFIG are all imported already.")
