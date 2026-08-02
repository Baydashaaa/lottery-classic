/**
 * Oracle Draw V2 — DrawEngine
 *
 * Читает winners.json, подтягивает снимок билетов раунда, строит
 * TicketModel и держит фазу. DOM не трогает.
 *
 * Правило про winner_index: индекс — основа, адрес — предохранитель.
 * Если tickets[winner_index] !== winner из winners.json, снимок не от
 * этого раунда → verified=false, колесо не крутим.
 */

import DrawAPI from "./DrawAPI.js";
import DrawEvents, { EVENTS } from "./DrawEvents.js";
import DrawState from "./DrawState.js";
import TicketModel from "../wheel/TicketModel.js";
import { PHASE, derivePhase } from "./DrawPhase.js";
import { CONFIG } from "./Config.js";
import { nextDeadline, prevDeadline, msToNextDeadline, inActiveWindow } from "./DrawClock.js";

export default class DrawEngine {

    constructor(pool = CONFIG.DAILY) {
        this.state = new DrawState(pool);
        this.api = new DrawAPI();
        this.events = new DrawEvents();
        this.data = { daily: [], weekly: [], meta: null };
        this.failures = 0;
        this.busy = false;
    }

    /* ---------- публичное ---------- */

    get pool() { return this.state.pool; }
    get phase() { return this.state.phase; }
    get model() { return this.state.model; }

    on(e, cb) { return this.events.on(e, cb); }
    once(e, cb) { return this.events.once(e, cb); }
    off(e, cb) { this.events.off(e, cb); }

    async setPool(pool) {
        if (pool !== CONFIG.DAILY && pool !== CONFIG.WEEKLY) return;
        if (pool === this.state.pool) return;
        this.state.reset(pool);
        await this.#adoptLatest({ silent: true });
        this.syncPhase();
        this.events.emit(EVENTS.DATA_UPDATED, this.snapshot());
    }

    /** Прокрутить ещё раз по текущему результату */
    replay() {
        const { round, model, verified } = this.state;
        if (!round || round.skipped || !model || !verified) return false;
        this.events.emit(EVENTS.DRAW_FINISHED, { round, model, replay: true });
        return true;
    }

    /** Мост сообщает, что анимация началась/кончилась — фаза REVEALING */
    beginReveal() { this.state.revealing = true; this.syncPhase(); }
    endReveal() { this.state.revealing = false; this.syncPhase(); }

    history() { return (this.data[this.state.pool] || []).slice(); }

    snapshot() {
        const now = Date.now();
        return {
            ...this.state.snapshot(),
            nextDeadline: nextDeadline(this.state.pool, now),
            remaining: msToNextDeadline(this.state.pool, now)
        };
    }

    /* ---------- цикл ---------- */

    async update({ force = false } = {}) {
        if (this.busy) return;
        this.busy = true;
        try {
            const payload = await this.api.load({ force });
            this.failures = 0;
            this.state.lastError = null;
            this.state.lastUpdateAt = Date.now();

            if (payload) {
                this.data = payload;
                this.events.emit(EVENTS.DATA_UPDATED, this.snapshot());
                await this.#adoptLatest({ silent: false });
            }
            this.syncPhase();
        } catch (err) {
            this.failures++;
            this.state.lastError = err.message || String(err);
            this.events.emit(EVENTS.ERROR, { error: err, failures: this.failures });
        } finally {
            this.busy = false;
        }
    }

    tick() {
        const now = Date.now();
        this.syncPhase(now);
        this.events.emit(EVENTS.TICK, {
            now,
            pool: this.state.pool,
            phase: this.state.phase,
            remaining: msToNextDeadline(this.state.pool, now)
        });
    }

    pollInterval(hidden = false) {
        if (hidden) return CONFIG.POLL_HIDDEN;
        // в PRE_DRAW и AWAITING опрашиваем часто независимо от расписания
        const hot = this.state.phase === PHASE.PRE_DRAW ||
                    this.state.phase === PHASE.AWAITING ||
                    inActiveWindow(this.state.pool);
        const base = hot ? CONFIG.POLL_ACTIVE : CONFIG.POLL_IDLE;
        if (this.failures === 0) return base;
        return base * Math.pow(2, Math.min(this.failures, CONFIG.MAX_BACKOFF_STEPS));
    }

    /* ---------- фаза ---------- */

    syncPhase(now = Date.now()) {
        const phase = derivePhase({
            now,
            deadline: nextDeadline(this.state.pool, now),
            lastDeadline: prevDeadline(this.state.pool, now),
            result: this.state.round,
            revealing: this.state.revealing,
            cfg: CONFIG
        });

        if (phase !== this.state.phase) {
            const from = this.state.phase;
            this.state.phase = phase;
            this.events.emit(EVENTS.PHASE_CHANGED, { from, to: phase, pool: this.state.pool });
        }
    }

    /* ---------- приём нового раунда ---------- */

    async #adoptLatest({ silent }) {
        const list = this.data[this.state.pool] || [];
        const latest = DrawAPI.pickLatest(list);
        if (!latest) { this.state.hydrated = true; return; }

        const firstLoad = !this.state.hydrated;
        if (latest.key === this.state.roundKey) { this.state.hydrated = true; return; }

        // снимок билетов + модель колеса
        const raw = await this.api.loadSnapshot(latest.key);
        const model = raw ? new TicketModel(raw, { maxSectors: CONFIG.MAX_SECTORS }) : null;
        const verified = !!(model && !latest.skipped &&
            model.verify(latest.winnerIndex, latest.winner));

        if (model && !latest.skipped && !verified) {
            console.warn(
                `[DrawEngine] снимок ${latest.key} не сходится: ` +
                `tickets[${latest.winnerIndex}] = ${model.addressForIndex(latest.winnerIndex)}, ` +
                `в winners.json ${latest.winner}. Колесо крутить не будем.`
            );
        }

        this.state.applyRound(latest, model, verified);
        this.state.hydrated = true;

        if (silent) return;

        this.events.emit(EVENTS.ROUND_CHANGED, { round: latest, firstLoad, model, verified });
        this.events.emit(EVENTS.RESULT_READY, { round: latest, firstLoad, model, verified });

        if (latest.skipped) {
            this.state.markSeen(latest.key);
            this.events.emit(EVENTS.DRAW_SKIPPED, { round: latest, firstLoad });
            return;
        }

        const seen = this.state.hasSeen(latest.key);
        const fresh = this.#isFresh(latest);
        this.state.markSeen(latest.key);

        if (!seen && (!firstLoad || fresh) && verified) {
            this.events.emit(EVENTS.DRAW_FINISHED, { round: latest, model, replay: false });
        }
        if (firstLoad) this.events.emit(EVENTS.READY, this.snapshot());
    }

    #isFresh(round, now = Date.now()) {
        if (round.drawnAt) return (now - round.drawnAt) <= CONFIG.FRESH_RESULT_MS;
        const prev = prevDeadline(this.state.pool, now);
        return prev !== null && (now - prev) <= CONFIG.FRESH_RESULT_MS;
    }
}
