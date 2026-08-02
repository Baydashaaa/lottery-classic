/**
 * Oracle Draw V2 — DrawBridge
 *
 * Связывает фазы движка с колесом и старым UI. Собственной физики и
 * собственного цикла кадров здесь больше нет — всё это живёт в
 * assets/js/wheel/. Мост только переводит фазу в команду.
 *
 *   PRE_DRAW / AWAITING → wheel.preDraw()   (холостое вращение, луч Оракула)
 *   DRAW_FINISHED       → wheel.spinToIndex(winner_index)
 *   REVEALED (перезаход)→ wheel.snapToIndex(...) без анимации
 */

import { EVENTS } from "./DrawEvents.js";
import { PHASE, PHASE_TEXT } from "./DrawPhase.js";
import { CONFIG } from "./Config.js";
import WheelRenderer from "../wheel/WheelRenderer.js";
import TicketModel from "../wheel/TicketModel.js";

export default class DrawBridge {

    constructor(engine) {
        this.engine = engine;
        this.wheel = null;
        this.queue = [];
        this.round = null;
        this.unsubs = [];
    }

    get ui() { return window.OracleDrawUI || null; }

    attach() {
        const on = (e, fn) => this.unsubs.push(this.engine.on(e, fn));

        // Поднимаем колесо сразу: пустое, но живое. Ждать данных нельзя —
        // в раунде без минтов их не будет вовсе.
        const boot = () => { this.refreshLive(); this.startIdle(); };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot, { once: true });
        } else {
            setTimeout(boot, 0);
        }

        on(EVENTS.PHASE_CHANGED, ({ to }) => this.onPhase(to));
        on(EVENTS.TICK, t => this.onTick(t));
        on(EVENTS.DRAW_FINISHED, ({ round, model }) => this.reveal(round, model));
        on(EVENTS.RESULT_READY, ({ round, model, firstLoad, verified }) => {
            if (model) this.mount(model, round.pool);
            if (firstLoad && !round.skipped && verified) this.showStatic(round, model);
            else if (firstLoad && !round.skipped) this.showStatic(round, null);
        });
        on(EVENTS.DRAW_SKIPPED, ({ round }) => this.showRollover(round));
        on(EVENTS.ROUND_CHANGED, () => {
            if (typeof window.loadWinners === "function") window.loadWinners();
        });
        return this;
    }

    detach() {
        this.unsubs.forEach(off => off());
        this.unsubs = [];
        if (this.wheel) this.wheel.destroy();
        this.wheel = null;
    }

    /* ── колесо ── */


    /**
     * Модель по ЖИВЫМ участникам текущего раунда — чтобы колесо было видно
     * до розыгрыша, а не только после появления снимка.
     *
     * Снимок остаётся авторитетным: он замораживает порядок билетов в момент
     * розыгрыша, и только по нему считается winner_index. Этот список —
     * предварительный показ, verified у него не бывает.
     */
    /** Показать колесо в холостом вращении, даже если данных ещё нет */
    startIdle() {
        const r = this.ensure(this.engine.pool);
        if (!r) { setTimeout(() => this.startIdle(), 400); return; }   // канвас ещё не в DOM
        if (!r.model) r.setModel(this.liveModel || null);
        r.idle();
        r.start();
        if (window.oracleDrawV2) window.oracleDrawV2.ownsWheel = true;
    }

    refreshLive() {
        const ui = this.ui;
        if (!ui || !ui.participants) return;
        if (this.engine.state.revealing) return;      // во время анимации не трогаем
        if (this.engine.state.model) return;          // снимок главнее

        // Пустой раунд — тоже состояние: колесо крутится вхолостую и пишет
        // «No entries yet». Раньше здесь стоял return, и канвас оставался
        // чёрным до первого минта.
        const pairs = (ui.participants() || []).filter(p => p && p[1] > 0);
        const model = new TicketModel({ tickets: pairs }, { maxSectors: 48 });

        this.liveModel = model;
        this.mount(model, ui.pool ? ui.pool() : this.engine.pool);
        if (window.oracleDrawV2) window.oracleDrawV2.ownsWheel = true;
    }

    ensure(pool) {
        if (this.wheel) return this.wheel;
        const canvas = document.getElementById("wheel-canvas");
        if (!canvas) return null;
        const reduced = typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.wheel = new WheelRenderer(canvas, { pool, reducedMotion: reduced });
        this.wheel.start();
        addEventListener("resize", () => this.wheel && this.wheel.resize());
        return this.wheel;
    }

    mount(model, pool) {
        const w = this.ensure(pool);
        if (!w) return;
        w.setPool(pool).setModel(model);
    }

    /* ── фазы ── */

    onPhase(phase) {
        const ui = this.ui;
        const w = this.wheel;

        if (phase === PHASE.PRE_DRAW || phase === PHASE.AWAITING) {
            if (w) w.preDraw();
            if (ui) { ui.entriesOpen(false); if (ui.wakeOracleEye) ui.wakeOracleEye(true); }
            return;
        }
        if (phase === PHASE.REVEALING) {
            if (ui) ui.entriesOpen(false);
            return;
        }
        if (w && phase !== PHASE.REVEALED) w.idle();
        if (ui) {
            ui.entriesOpen(phase === PHASE.OPEN || phase === PHASE.ROLLOVER);
            if (ui.wakeOracleEye) ui.wakeOracleEye(false);
        }
    }

    onTick({ phase, remaining }) {
        const ui = this.ui;
        if (!ui || phase === PHASE.REVEALING || phase === PHASE.REVEALED) return;
        const text = PHASE_TEXT[phase];
        if (!text) return;
        const t = remaining !== null ? ui.fmtShort(remaining) : "";
        ui.msg(text.title.replace("{t}", t), text.sub.replace("{t}", t), phaseColor(phase));
    }

    /* ── розыгрыш ── */

    reveal(round, model) {
        const w = this.ensure(round.pool);
        if (!w || !model) { this.showStatic(round, null); return; }

        this.mount(model, round.pool);
        this.round = round;
        this.queue = round.winners.slice();
        this.engine.beginReveal();
        this.next();
    }

    next() {
        const w = this.queue.shift();
        if (!w) {
            this.engine.endReveal();
            if (this.ui) {
                this.ui.msg(
                    this.round.winners.length > 1 ? "All Winners Selected" : "Winner Selected",
                    "Payouts sent automatically", "#66ffaa"
                );
            }
            return;
        }

        const index = w.index ?? this.round.winnerIndex;
        this.wheel.onLanded = () => {
            this.wheel.onLanded = null;
            if (this.ui) {
                this.ui.card({
                    address: w.address, prize: w.prize, tx: w.tx,
                    label: this.round.winners.length > 1 ? placeLabel(w.place) : null
                });
            }
            setTimeout(() => this.next(), CONFIG.REVEAL_HOLD);
        };

        if (this.ui) {
            this.ui.msg("Selecting winner",
                `Ticket #${index} of ${this.wheel.model.total}`, "#00c8ff");
        }
        if (!this.wheel.spinToIndex(index)) { this.wheel.onLanded = null; this.next(); }
    }

    /* ── статика ── */

    showStatic(round, model) {
        const ui = this.ui;
        if (!ui || round.skipped) return;
        const w = round.winners[0];
        if (!w) return;
        if (model && this.wheel && round.winnerIndex !== null) {
            this.wheel.snapToIndex(round.winnerIndex);
        }
        ui.msg("Winner Selected",
            model ? (round.date ? "Draw of " + round.date : "Payout sent automatically")
                  : "Result verified on-chain — replay unavailable for this round",
            "#66ffaa");
        ui.card({ address: w.address, prize: w.prize, tx: w.tx, label: null });
    }

    showRollover(round) {
        if (!this.ui) return;
        this.ui.msg("Round rolled over",
            round.reason || "Not enough entries — tickets stay active", "#ff9944");
    }
}

function placeLabel(p) { return ["1st Place","2nd Place","3rd Place"][p-1] || p+"th Place"; }

function phaseColor(phase) {
    switch (phase) {
        case PHASE.LOCKED: return "rgba(255,80,80,0.9)";
        case PHASE.PRE_DRAW:
        case PHASE.AWAITING: return "#a78bfa";
        case PHASE.ROLLOVER: return "#ff9944";
        default: return "rgba(0,200,255,0.7)";
    }
}
