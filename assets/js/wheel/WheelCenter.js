/**
 * Oracle Draw — WheelCenter (Oracle Core)
 *
 * Центр не пустой. Три независимых кольца: по часовой, против, и медленное.
 * Внутри — эмблема темы (Oracle для daily, кубок для weekly) и пульсы,
 * расходящиеся наружу.
 */

const TAU = Math.PI * 2;

export default class WheelCenter {

    constructor(theme) {
        this.theme = theme;
        this.pulses = [];
        this.lastPulse = 0;
    }

    setTheme(theme) { this.theme = theme; return this; }

    draw(ctx, cx, cy, r, t, quality, energy = 0) {
        const th = this.theme;
        const R = r * 0.30;                       // радиус ядра

        // хаб
        ctx.save();
        const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        hub.addColorStop(0, th.core.hub);
        hub.addColorStop(0.72, th.core.hub);
        hub.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = hub;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.fill();
        ctx.restore();

        // пульсы наружу
        this.#emitPulses(t, energy);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const p of this.pulses) {
            const age = (t - p.born) / p.life;
            if (age >= 1) continue;
            ctx.globalAlpha = (1 - age) * 0.4;
            ctx.strokeStyle = th.core.pulse;
            ctx.lineWidth = 1.6 * (1 - age) + 0.4;
            ctx.beginPath();
            ctx.arc(cx, cy, R * (0.45 + age * 1.15), 0, TAU);
            ctx.stroke();
        }
        ctx.restore();
        this.pulses = this.pulses.filter(p => (t - p.born) < p.life);

        // три кольца
        this.#ring(ctx, cx, cy, R * 0.92, t / 6200, th.core.r1, 2.2, 7, quality);
        this.#ring(ctx, cx, cy, R * 0.72, -t / 4300, th.core.r2, 1.8, 11, quality);
        this.#ring(ctx, cx, cy, R * 0.52, t / 14000, th.core.r3, 1.2, 5, quality);

        // эмблема
        ctx.save();
        ctx.translate(cx, cy);
        const s = R * 0.34;
        ctx.globalAlpha = 0.92;
        if (th.core.emblem === "trophy") this.#trophy(ctx, s, th);
        else this.#oracle(ctx, s, th, t);
        ctx.restore();
    }

    #emitPulses(t, energy) {
        const gap = 1400 - energy * 900;
        if (t - this.lastPulse > gap) {
            this.lastPulse = t;
            this.pulses.push({ born: t, life: 2200 });
        }
    }

    /** Кольцо с насечками — вращается само по себе */
    #ring(ctx, cx, cy, r, rot, color, width, teeth, quality) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot * TAU);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (quality.bloom) { ctx.shadowColor = color; ctx.shadowBlur = 8 * quality.shadowBlur; }
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.stroke();

        for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * TAU;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
            ctx.lineTo(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12);
            ctx.lineWidth = width * 0.8;
            ctx.stroke();
        }
        ctx.restore();
    }

    #oracle(ctx, s, th, t) {
        // сеть узлов — тот же мотив, что у Oracle Eye на сайте
        ctx.strokeStyle = th.core.r1;
        ctx.fillStyle = th.core.r1;
        ctx.lineWidth = 1.1;
        const n = 6;
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU - Math.PI / 2;
            pts.push([Math.cos(a) * s, Math.sin(a) * s]);
        }
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.stroke();
        pts.forEach(([x, y]) => {
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
        });
        const p = 0.5 + 0.5 * Math.sin(t / 900);
        ctx.beginPath();
        ctx.arc(0, 0, 3 + p * 2, 0, TAU);
        ctx.fill();
    }

    #trophy(ctx, s, th) {
        ctx.strokeStyle = th.core.r1;
        ctx.fillStyle = th.core.r2;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.55, -s * 0.7);
        ctx.lineTo(s * 0.55, -s * 0.7);
        ctx.quadraticCurveTo(s * 0.5, s * 0.25, 0, s * 0.42);
        ctx.quadraticCurveTo(-s * 0.5, s * 0.25, -s * 0.55, -s * 0.7);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, s * 0.42); ctx.lineTo(0, s * 0.78);
        ctx.moveTo(-s * 0.42, s * 0.9); ctx.lineTo(s * 0.42, s * 0.9);
        ctx.stroke();
        // ушки
        ctx.beginPath();
        ctx.arc(-s * 0.68, -s * 0.28, s * 0.24, Math.PI * 0.4, Math.PI * 1.6);
        ctx.moveTo(s * 0.68, -s * 0.52);
        ctx.arc(s * 0.68, -s * 0.28, s * 0.24, Math.PI * 1.4, Math.PI * 0.6);
        ctx.stroke();
    }
}
