/* Oracle Draw V2 — собранный бандл. НЕ РЕДАКТИРОВАТЬ.
   Источники: assets/js/wheel/ и assets/js/draw-v2/
   Пересобрать: node dev/_build_bundle.js
   Версия сборки: 202608021457 */

/* ── WheelTheme.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelTheme
 *
 * Все цвета, толщины и тайминги живут здесь. Ни один другой модуль не
 * содержит хардкодного цвета: тема приходит параметром. Поэтому Daily и
 * Weekly — не два рендерера, а два набора токенов.
 *
 * DAILY  — Ancient Oracle Machine: золото, бронза, тёмно-синий.
 * WEEKLY — Council of Oracles: фиолет, белая энергия, золотые акценты.
 */

const RARITY = {
    common:    { key: "common",    label: "COMMON",    base: "#c8cdd8", edge: "#8f97a8", glow: "rgba(200,205,216,0.55)" },
    rare:      { key: "rare",      label: "RARE",      base: "#4d9bff", edge: "#2a6fd0", glow: "rgba(77,155,255,0.60)" },
    legendary: { key: "legendary", label: "LEGENDARY", base: "#ff5c4d", edge: "#ffbf4d", glow: "rgba(255,140,60,0.70)" }
};

const DAILY = {
    key: "daily",
    name: "Ancient Oracle Machine",

    bg:        { top: "#070b14", bottom: "#0d1424", vignette: "rgba(0,0,0,0.65)" },
    ring:      { inner: "#7a5a1e", mid: "#f4d477", outer: "#a87c28", edge: "#5a4014",
                 width: 0.06, glow: "rgba(244,212,119,0.55)", pulseMs: 5000 },
    engraving: "rgba(255,236,180,0.35)",
    plate:     { from: "#0a1020", to: "#050810" },
    spoke:     "rgba(244,212,119,0.16)",

    core:      { r1: "#f4d477", r2: "#c89a3c", r3: "rgba(244,212,119,0.45)",
                 hub: "#070b14", pulse: "rgba(244,212,119,0.5)", emblem: "oracle" },

    pointer:   { frame: "#f4d477", frameEdge: "#8a6414", core: "#fff6dc",
                 energy: "#ffd166", glow: "rgba(255,209,102,0.85)" },

    text:      { primary: "#f6efe0", secondary: "rgba(246,239,224,0.62)", accent: "#f4d477" },
    particles: { color: "rgba(255,224,150,0.9)", count: 90 },
    winner:    { glow: "rgba(255,214,120,0.95)", grow: 0.08, dim: 0.25 }
};

const WEEKLY = {
    key: "weekly",
    name: "Council of Oracles",

    bg:        { top: "#080614", bottom: "#150e2a", vignette: "rgba(0,0,0,0.65)" },
    ring:      { inner: "#4a2b8f", mid: "#b98cff", outer: "#6f3fd0", edge: "#2c1a55",
                 width: 0.06, glow: "rgba(185,140,255,0.55)", pulseMs: 5000 },
    engraving: "rgba(232,214,255,0.35)",
    plate:     { from: "#0d0820", to: "#06040f" },
    spoke:     "rgba(185,140,255,0.16)",

    core:      { r1: "#e8d6ff", r2: "#a06cff", r3: "rgba(185,140,255,0.45)",
                 hub: "#080614", pulse: "rgba(200,160,255,0.5)", emblem: "trophy" },

    pointer:   { frame: "#c8a2ff", frameEdge: "#4a2b8f", core: "#ffffff",
                 energy: "#e0c8ff", glow: "rgba(200,160,255,0.85)" },

    text:      { primary: "#f2ecff", secondary: "rgba(242,236,255,0.62)", accent: "#c8a2ff" },
    particles: { color: "rgba(220,190,255,0.9)", count: 110 },
    winner:    { glow: "rgba(210,170,255,0.95)", grow: 0.08, dim: 0.25 }
};

/**
 * Уровни качества. Бриф просит частицы, блум и три вращающихся кольца —
 * на десктопе это дёшево, на среднем Android нет. Плюс в проекте уже
 * ловили просадку отрисовки от полноэкранных композитных слоёв.
 */
const QUALITY = {
    high:   { particles: 1.0, stars: 1.0, bloom: true,  engravings: true,  reflections: true,  shadowBlur: 1.0 },
    medium: { particles: 0.5, stars: 0.5, bloom: true,  engravings: true,  reflections: false, nftImages: true,  shadowBlur: 0.6 },
    low:    { particles: 0.0, stars: 0.2, bloom: false, engravings: false, reflections: false, nftImages: true,  shadowBlur: 0.0 },
    still:  { particles: 0.0, stars: 0.0, bloom: false, engravings: true,  reflections: false, nftImages: true,  shadowBlur: 0.0 }
};

function detectQuality() {
    if (typeof window === "undefined") return "high";
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return "still";
    const coarse = window.matchMedia && window.matchMedia("(hover:none)").matches;
    const cores = navigator.hardwareConcurrency || 4;
    const narrow = window.innerWidth <= 768;
    if (coarse && (cores <= 4 || narrow)) return "low";
    if (coarse || narrow) return "medium";
    return "high";
}

function getTheme(pool) {
    return pool === "weekly" ? WEEKLY : DAILY;
}

function rarityOf(tier) {
    return RARITY[String(tier || "common").toLowerCase()] || RARITY.common;
}



/* ── WheelGlow.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelGlow
 * Свет: мягкое сияние, градиенты металла, бархатный фон.
 * Бриф прямо запрещает сильный блюр, поэтому здесь только shadowBlur,
 * радиальные градиенты и аккуратный additive-проход.
 */

const TAU = Math.PI * 2;

/** Металл обода: щётка по кругу, а не плоская заливка */
function brushedRing(ctx, cx, cy, r, width, theme, t) {
    const g = ctx.createRadialGradient(cx, cy, r - width, cx, cy, r);
    g.addColorStop(0.00, theme.ring.inner);
    g.addColorStop(0.35, theme.ring.mid);
    g.addColorStop(0.60, theme.ring.outer);
    g.addColorStop(1.00, theme.ring.edge);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r - width / 2, 0, TAU);
    ctx.stroke();
}

/** Бегущие блики по ободу */
function ringReflections(ctx, cx, cy, r, width, theme, t, count = 3) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
        const a = (t / 9000 + i / count) * TAU;
        const arc = 0.22;
        const g = ctx.createLinearGradient(
            cx + Math.cos(a - arc) * r, cy + Math.sin(a - arc) * r,
            cx + Math.cos(a + arc) * r, cy + Math.sin(a + arc) * r
        );
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.30)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = width * 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, r - width / 2, a - arc, a + arc);
        ctx.stroke();
    }
    ctx.restore();
}

/** Дыхание обода — один цикл на pulseMs */
function ringPulse(ctx, cx, cy, r, theme, t, quality) {
    if (!quality.bloom) return;
    const p = 0.5 + 0.5 * Math.sin((t / theme.ring.pulseMs) * TAU);
    ctx.save();
    ctx.globalAlpha = 0.18 + p * 0.28;
    ctx.shadowColor = theme.ring.glow;
    ctx.shadowBlur = (18 + p * 26) * quality.shadowBlur;
    ctx.strokeStyle = theme.ring.glow;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.005, 0, TAU);
    ctx.stroke();
    ctx.restore();
}

/** Космический фон под колесом */
function cosmicBackdrop(ctx, w, h, theme) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.bg.top);
    g.addColorStop(1, theme.bg.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, theme.bg.vignette);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
}

/** Тёмная плита под секторами, чтобы редкости читались на глубине */
function facePlate(ctx, cx, cy, r, theme) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
    g.addColorStop(0, theme.plate.from);
    g.addColorStop(1, theme.plate.to);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
}

/** Локальное сияние вокруг точки (победитель, кристалл) */
function bloom(ctx, x, y, radius, color, strength, quality) {
    if (!quality.bloom || strength <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = Math.min(1, strength);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.restore();
}


const Glow = { brushedRing, ringReflections, ringPulse, cosmicBackdrop, facePlate, bloom };


/* ── WheelParticles.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelParticles
 * Две системы: искры внутри обода и звёздная пыль на фоне.
 * Обе детерминированы по сиду, чтобы кадр можно было воспроизвести.
 */



function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class WheelParticles {

    constructor(seed = 20260801) {
        this.rand = mulberry(seed);
        this.ring = [];
        this.stars = [];
        this.built = 0;
    }

    build(count, starCount) {
        this.ring = Array.from({ length: count }, () => ({
            a: this.rand() * TAU,
            rr: 0.42 + this.rand() * 0.52,      // положение внутри обода
            speed: (0.04 + this.rand() * 0.14) * (this.rand() < 0.5 ? -1 : 1),
            size: 0.6 + this.rand() * 1.8,
            phase: this.rand() * TAU
        }));
        this.stars = Array.from({ length: starCount }, () => ({
            x: this.rand(), y: this.rand(),
            size: 0.4 + this.rand() * 1.3,
            phase: this.rand() * TAU,
            drift: (this.rand() - 0.5) * 0.004
        }));
        this.built = count + starCount;
        return this;
    }

    /** Звёзды рисуются в экранных координатах, до колеса */
    drawStars(ctx, w, h, t, quality) {
        if (!quality.stars) return;
        ctx.save();
        for (const s of this.stars) {
            const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1400 + s.phase));
            ctx.globalAlpha = tw * 0.55 * quality.stars;
            ctx.fillStyle = "#ffffff";
            const x = ((s.x + s.drift * t / 1000) % 1 + 1) % 1;
            ctx.beginPath();
            ctx.arc(x * w, s.y * h, s.size, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    /** Искры в обойме — крутятся вместе с колесом, но со своим сносом */
    drawRing(ctx, cx, cy, rOuter, rInner, theme, t, quality, wheelAngle) {
        if (!quality.particles) return;
        const n = Math.round(this.ring.length * quality.particles);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = theme.particles.color;
        for (let i = 0; i < n; i++) {
            const p = this.ring[i];
            const a = p.a + wheelAngle * 0.35 + (t / 1000) * p.speed;
            const r = rInner + (rOuter - rInner) * p.rr;
            const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 700 + p.phase));
            ctx.globalAlpha = pulse * 0.8;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, p.size * pulse, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    /** Искры вокруг сектора-победителя */
    drawWinnerSparks(ctx, cx, cy, r, angle, span, theme, t, quality) {
        if (!quality.particles) return;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = theme.winner.glow;
        const n = 26;
        for (let i = 0; i < n; i++) {
            const p = this.ring[i % this.ring.length];
            const local = ((t / 1600) + p.phase / TAU) % 1;
            const a = angle + span * local;
            const rad = r * (0.55 + 0.42 * (0.5 + 0.5 * Math.sin(t / 500 + p.phase)));
            ctx.globalAlpha = (1 - local) * 0.8;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, p.size * 1.4, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }
}


/* ── WheelSector.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelSector
 *
 * Один сектор = один кошелёк. Угол пропорционален числу билетов, значит
 * видимая площадь равна вероятности выигрыша.
 *
 * ВАЖНОЕ РАСХОЖДЕНИЕ С МАКЕТОМ. На макете у всех секторов одинаковая
 * ширина, хотя подписи разные: 20 билетов, 15, 12, 5. Так нельзя — это
 * ровно та подмена, которую мы убрали из старого колеса: глаз читает
 * равные шансы там, где шансы отличаются вчетверо.
 *
 * Поэтому сектора взвешенные, а вместо обрезки контента введены уровни
 * детализации: чем уже сектор, тем меньше в нём помещается. Никакой
 * элемент не рисуется, если под него нет места — вместо мельтешения
 * остаётся чистая цветная полоса редкости.
 *
 *   FULL    — номер + кошелёк + билеты
 *   COMPACT — номер + билеты
 *   TICK    — только цвет редкости
 *
 * Картинок NFT в секторах нет: маски рисуются одинаковыми кружками на
 * любом масштабе, съедают место под подписи и заставляют ждать загрузку
 * с домена. Номер читается всегда и на любой ширине сектора.
 */




const DETAIL = { FULL: "FULL", COMPACT: "COMPACT", TICK: "TICK" };

/** Сколько пикселей дуги есть у сектора на радиусе подписи */
function detailFor(sector, r) {
    const arc = sector.span * r * 0.68;
    if (arc >= 54) return DETAIL.FULL;      // пороги ниже, чем были с картинкой
    if (arc >= 26) return DETAIL.COMPACT;
    return DETAIL.TICK;
}

/**
 * Что писать крупно в секторе.
 *  "token"   — номер NFT (#144), как на макете
 *  "ordinal" — порядковый номер кошелька в раунде (№7)
 * У кошелька с несколькими NFT номер токена один из нескольких, поэтому
 * при спорах о том, «чей это сектор», ordinal однозначнее.
 */
const LABEL_MODE = { value: "token" };

function bigLabel(s, meta) {
    if (LABEL_MODE.value === "ordinal") return "№" + s.number;
    if (meta.tokenId !== undefined && meta.tokenId !== null) return "#" + meta.tokenId;
    return "№" + s.number;
}

/** Оставлено пустым: картинки в секторах убраны, вызовы не ломаются. */
function preloadArt() { return null; }

class WheelSector {

    constructor(theme) {
        this.theme = theme;
    }

    setTheme(theme) { this.theme = theme; return this; }

    /**
     * @param {object} s        сектор из TicketModel (+ s.meta: {tokenId, tier, image})
     * @param {object} state    {angle, dim, scale, active, winner, t}
     */
    draw(ctx, cx, cy, r, s, state, quality) {
        const th = this.theme;
        const meta = s.meta || {};
        const rar = rarityOf(meta.tier);
        const a0 = state.angle + s.startAngle;
        const a1 = state.angle + s.endAngle;
        const mid = (a0 + a1) / 2;
        const R = r * (state.scale || 1);

        ctx.save();
        ctx.globalAlpha = state.dim ?? 1;

        // тело сектора: от тёмного центра к цвету редкости у обода
        const g = ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, R);
        g.addColorStop(0, "rgba(255,255,255,0.02)");
        g.addColorStop(0.62, hexA(rar.base, s.isGroup ? 0.10 : 0.16));
        g.addColorStop(1, hexA(rar.base, s.isGroup ? 0.20 : 0.34));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fill();

        // активный сектор — «Оракул сканирует участника»
        if (state.active > 0) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = state.active * 0.30;
            ctx.fillStyle = rar.glow;
            ctx.fill();
            ctx.restore();
        }

        // спицы
        ctx.strokeStyle = th.spoke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
        ctx.stroke();

        // дуга редкости у обода
        ctx.strokeStyle = rar.edge;
        ctx.lineWidth = Math.max(1.5, r * 0.012);
        ctx.globalAlpha = (state.dim ?? 1) * (0.55 + state.active * 0.45);
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.985, a0, a1);
        ctx.stroke();
        ctx.globalAlpha = state.dim ?? 1;

        const detail = detailFor(s, R);
        if (detail !== DETAIL.TICK) {
            this.#content(ctx, cx, cy, R, s, meta, rar, mid, detail, state, quality);
        }

        ctx.restore();
    }

    /**
     * Контент разворачивается К ЦЕНТРУ, без гнутого текста — как в брифе.
     * Ось подписи направлена по биссектрисе, текст читается снизу вверх
     * на левой половине и сверху вниз на правой, чтобы не вставать вверх ногами.
     */
    #content(ctx, cx, cy, R, s, meta, rar, mid, detail, state, quality) {
        const th = this.theme;
        const rr = R * 0.68;
        const x = cx + Math.cos(mid) * rr;
        const y = cy + Math.sin(mid) * rr;
        const flip = Math.cos(mid) < 0;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(mid + (flip ? Math.PI : 0));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const unit = R * 0.055;
        let cursor = 0;

        if (s.isGroup) {
            ctx.fillStyle = th.text.primary;
            ctx.font = `600 ${unit * 1.15}px ui-sans-serif, system-ui, sans-serif`;
            ctx.fillText(`+${s.members.length} wallets`, 0, cursor);
            ctx.fillStyle = th.text.secondary;
            ctx.font = `${unit * 0.9}px ui-monospace, monospace`;
            ctx.fillText(plural(s.entries), 0, cursor + unit * 1.25);
            ctx.restore();
            return;
        }

        // Крупный номер — единственный обязательный элемент сектора.
        ctx.fillStyle = state.winner ? th.text.accent : th.text.primary;
        ctx.font = `800 ${unit * 1.6}px ui-sans-serif, system-ui, sans-serif`;
        if (quality.bloom && state.active > 0.4) {
            ctx.shadowColor = rar.glow;
            ctx.shadowBlur = 14 * quality.shadowBlur * state.active;
        }
        ctx.fillText(bigLabel(s, meta), 0, cursor);
        ctx.shadowBlur = 0;
        cursor += unit * 1.6;

        // тонкая черта цвета редкости — вместо картинки
        ctx.strokeStyle = rar.base;
        ctx.globalAlpha = (state.dim ?? 1) * 0.75;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-unit * 1.1, cursor - unit * 0.62);
        ctx.lineTo(unit * 1.1, cursor - unit * 0.62);
        ctx.stroke();
        ctx.globalAlpha = state.dim ?? 1;

        if (detail === DETAIL.FULL) {
            ctx.fillStyle = rar.base;
            ctx.font = `${unit * 0.92}px ui-monospace, monospace`;
            ctx.fillText(shortAddr(s.address), 0, cursor);
            cursor += unit * 1.1;

            // Тир NFT — то, что человек на самом деле сминтил
            if (meta.tier) {
                ctx.fillStyle = rar.base;
                ctx.font = `600 ${unit * 0.72}px ui-sans-serif, system-ui, sans-serif`;
                ctx.globalAlpha = (state.dim ?? 1) * 0.85;
                ctx.fillText(rar.label, 0, cursor);
                ctx.globalAlpha = state.dim ?? 1;
                cursor += unit * 0.95;
            }
        }

        ctx.fillStyle = th.text.secondary;
        ctx.font = `${unit * 0.85}px ui-monospace, monospace`;
        ctx.fillText(plural(s.entries), 0, cursor);

        ctx.restore();
    }

    /** Обводка и искры победителя рисуются поверх всех секторов */
    drawWinnerFrame(ctx, cx, cy, r, s, angle, t, quality) {
        const th = this.theme;
        const a0 = angle + s.startAngle;
        const a1 = angle + s.endAngle;
        const R = r * (1 + th.winner.grow);
        const p = 0.5 + 0.5 * Math.sin(t / 620);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.strokeStyle = th.winner.glow;
        ctx.lineWidth = 2 + p * 2;
        if (quality.bloom) {
            ctx.shadowColor = th.winner.glow;
            ctx.shadowBlur = (18 + p * 26) * quality.shadowBlur;
        }
        ctx.stroke();

        // бегущий пунктир по дуге
        ctx.setLineDash([r * 0.03, r * 0.03]);
        ctx.lineDashOffset = -(t / 22) % (r * 0.06);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.99, a0, a1);
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * На сайте единица участия называется entry, а не ticket: пользователь
 * минтит NFT, и тир определяет, сколько entries он даёт (1 / 5 / 10).
 */
function plural(n) {
    return n + (n === 1 ? " entry" : " entries");
}

function shortAddr(a) {
    if (!a) return "";
    return a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
}

function hexA(hex, alpha) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}



/* ── WheelPointer.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelPointer (Oracle Crystal)
 *
 * Треугольника нет. Кристалл-ромб в золотой оправе, внутри живая энергия.
 * Яркость растёт по мере замедления: аргумент `intensity` 0..1 приходит
 * из анимации (1 - v/vMax), поэтому «загорается на подлёте» само собой.
 */



class WheelPointer {

    constructor(theme) {
        this.theme = theme;
        this.flash = 0;          // короткая вспышка при защёлкивании
    }

    setTheme(theme) { this.theme = theme; return this; }

    /** Дёрнуть вспышку — зовётся в момент фиксации победителя */
    strike() { this.flash = 1; return this; }

    /**
     * @param {number} intensity 0..1 — насколько «горячий» кристалл
     * @param {number} tick      0..1 — реакция на проезжающий сектор
     */
    draw(ctx, cx, cy, r, t, intensity, quality, tick = 0) {
        const th = this.theme;
        const h = r * 0.16;                     // высота кристалла
        const w = h * 0.62;
        const y = cy - r - h * 0.12;             // сидит на ободе сверху

        this.flash *= 0.90;
        const heat = Math.min(1, intensity + this.flash * 0.8 + tick * 0.25);

        ctx.save();
        ctx.translate(cx, y);

        // сияние под кристаллом
        if (quality.bloom) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const g = ctx.createRadialGradient(0, h * 0.35, 0, 0, h * 0.35, h * (1.4 + heat));
            g.addColorStop(0, th.pointer.glow);
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.globalAlpha = 0.35 + heat * 0.55;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, h * 0.35, h * (1.4 + heat), 0, TAU);
            ctx.fill();
            ctx.restore();
        }

        // оправа
        this.#diamond(ctx, w * 1.18, h * 1.18);
        const frame = ctx.createLinearGradient(-w, -h, w, h);
        frame.addColorStop(0, th.pointer.frameEdge);
        frame.addColorStop(0.45, th.pointer.frame);
        frame.addColorStop(1, th.pointer.frameEdge);
        ctx.fillStyle = frame;
        ctx.fill();

        // тело кристалла
        this.#diamond(ctx, w, h);
        const body = ctx.createLinearGradient(0, -h, 0, h);
        body.addColorStop(0, th.pointer.core);
        body.addColorStop(0.5, th.pointer.energy);
        body.addColorStop(1, th.pointer.frameEdge);
        ctx.fillStyle = body;
        ctx.globalAlpha = 0.85 + heat * 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;

        // энергия внутри: две встречные волны
        ctx.save();
        this.#diamond(ctx, w, h);
        ctx.clip();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 2; i++) {
            const p = ((t / (900 - i * 260)) % 1);
            const yy = -h + 2 * h * (i === 0 ? p : 1 - p);
            ctx.globalAlpha = (0.25 + heat * 0.5) * (1 - Math.abs(yy) / h * 0.6);
            ctx.fillStyle = th.pointer.core;
            ctx.fillRect(-w, yy - h * 0.06, w * 2, h * 0.12);
        }
        ctx.restore();

        // грань
        this.#diamond(ctx, w, h);
        ctx.strokeStyle = th.pointer.frame;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // остриё смотрит в обод
        ctx.beginPath();
        ctx.moveTo(-w * 0.28, h * 0.92);
        ctx.lineTo(0, h * 1.55);
        ctx.lineTo(w * 0.28, h * 0.92);
        ctx.closePath();
        ctx.fillStyle = th.pointer.frame;
        ctx.fill();

        ctx.restore();
    }

    #diamond(ctx, w, h) {
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(-w, 0);
        ctx.closePath();
    }
}


/* ── WheelCenter.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelCenter (Oracle Core)
 *
 * Центр не пустой. Три независимых кольца: по часовой, против, и медленное.
 * Внутри — эмблема темы (Oracle для daily, кубок для weekly) и пульсы,
 * расходящиеся наружу.
 */



class WheelCenter {

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


/* ── WheelAnimation.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelAnimation
 *
 * Физика, а не CSS-твин. Профиль скорости решается ЗАРАНЕЕ, поэтому
 * посадка на нужный угол точная, а скорость непрерывна во всех стыках —
 * включая старт из уже вращающегося колеса (PreDraw).
 *
 * Фазы:  IDLE → PREDRAW → ACCEL → CRUISE → DECEL → LOCK → WINNER → REST
 *
 * Решение профиля. Известны: v0 (текущая скорость), нужный путь D.
 *   разгон   tA: v идёт v0→vMax по smootherstep, путь = (v0+vMax)/2 * tA
 *   крейсер  tB: путь = vMax * tB
 *   торможение tC: v = vMax*(1-u)^2, путь = vMax*tC/3
 * Из D находим tB. Если он отрицательный — добавляем полный оборот к D
 * и решаем снова. Так «6 оборотов» никогда не превращаются в 15.
 */



const MOTION = {
    IDLE: "IDLE", PREDRAW: "PREDRAW", ACCEL: "ACCEL", CRUISE: "CRUISE",
    DECEL: "DECEL", LOCK: "LOCK", WINNER: "WINNER", REST: "REST"
};

const DEFAULTS = {
    idleRpm: 1.2,
    predrawRpm: 6,
    maxRpm: 150,
    accelMs: 1400,
    decelMs: 3600,
    minCruiseMs: 500,
    lockDeg: 2.6,          // откат назад при защёлкивании
    lockMs: 620,
    winnerMs: 1800,
    minTurns: 5
};

const rpm = v => (v * TAU) / 60;
const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);

class WheelAnimation {

    constructor(opts = {}) {
        this.cfg = { ...DEFAULTS, ...opts };
        this.mode = MOTION.REST;
        this.angle = 0;
        this.velocity = 0;
        this.plan = null;
        this.t0 = 0;
        this.onSettle = null;
        this.reducedMotion = false;
    }

    get isSpinning() {
        return this.mode === MOTION.ACCEL || this.mode === MOTION.CRUISE ||
               this.mode === MOTION.DECEL || this.mode === MOTION.LOCK;
    }

    /** 0..1 — насколько колесо «горячее». Кристалл берёт отсюда яркость. */
    get intensity() {
        const vMax = rpm(this.cfg.maxRpm);
        if (this.mode === MOTION.WINNER) return 1;
        if (!this.isSpinning) return 0.05;
        return Math.max(0, Math.min(1, 1 - Math.abs(this.velocity) / vMax));
    }

    idle(now) { this.mode = MOTION.IDLE; this.t0 = now; this.plan = null; }
    predraw(now) { this.mode = MOTION.PREDRAW; this.t0 = now; this.plan = null; }
    rest() { this.mode = MOTION.REST; this.plan = null; this.velocity = 0; }

    /**
     * Запустить розыгрыш до угла модели.
     * @param {number} now
     * @param {number} targetModelAngle угол билета внутри модели
     * @param {number} pointerAngle     угол указателя (обычно -π/2)
     * @param {function} onSettle       вызовется после LOCK
     */
    spinTo(now, targetModelAngle, pointerAngle, onSettle) {
        const c = this.cfg;
        this.onSettle = onSettle || null;

        // куда сесть: ближайшая позиция ниже текущего угла + обороты
        const base = pointerAngle - targetModelAngle;
        const back = (((this.angle - base) % TAU) + TAU) % TAU;
        const landing = this.angle - back;

        if (this.reducedMotion) {
            this.angle = landing;
            this.velocity = 0;
            this.mode = MOTION.WINNER;
            this.t0 = now;
            if (this.onSettle) this.onSettle();
            return this.plan = { skipped: true, land: landing };
        }

        const v0 = Math.abs(this.velocity);
        const vMax = rpm(c.maxRpm);
        const tA = c.accelMs / 1000, tC = c.decelMs / 1000;
        const dA = ((v0 + vMax) / 2) * tA;
        const dC = (vMax * tC) / 3;

        let turns = Math.max(c.minTurns, 1);
        let D = back + turns * TAU;
        let tB = (D - dA - dC) / vMax;
        while (tB < c.minCruiseMs / 1000) {          // не хватает пути — добавляем оборот
            turns += 1;
            D = back + turns * TAU;
            tB = (D - dA - dC) / vMax;
        }

        this.plan = {
            v0, vMax, tA, tB, tC,
            dA, dB: vMax * tB, dC,
            D,
            from: this.angle,
            land: this.angle - D,
            turns
        };
        this.mode = MOTION.ACCEL;
        this.t0 = now;
        return this.plan;
    }

    /** @returns {{angle:number, velocity:number, mode:string}} */
    step(now) {
        const c = this.cfg;
        const dt = 1 / 60;
        const el = (now - this.t0) / 1000;

        switch (this.mode) {
            case MOTION.IDLE:
            case MOTION.PREDRAW: {
                const target = -rpm(this.mode === MOTION.IDLE ? c.idleRpm : c.predrawRpm);
                this.velocity += (target - this.velocity) * Math.min(dt * 1.6, 1);
                this.angle += this.velocity * dt;
                break;
            }
            case MOTION.ACCEL: {
                const p = this.plan, u = Math.min(el / p.tA, 1);
                const s = smoother(u);
                this.velocity = -(p.v0 + (p.vMax - p.v0) * s);
                this.angle = p.from - (p.v0 * el + (p.vMax - p.v0) * p.tA * integralSmoother(u));
                if (u >= 1) { this.mode = MOTION.CRUISE; this.t0 = now; }
                break;
            }
            case MOTION.CRUISE: {
                const p = this.plan, u = Math.min(el / p.tB, 1);
                this.velocity = -p.vMax;
                this.angle = p.from - p.dA - p.vMax * el;
                if (u >= 1) { this.mode = MOTION.DECEL; this.t0 = now; }
                break;
            }
            case MOTION.DECEL: {
                const p = this.plan, u = Math.min(el / p.tC, 1);
                const k = 1 - u;
                this.velocity = -p.vMax * k * k;
                // интеграл vMax*(1-u)^2 dt = vMax*tC*(1-(1-u)^3)/3
                this.angle = p.from - p.dA - p.dB - (p.vMax * p.tC / 3) * (1 - k * k * k);
                if (u >= 1) {
                    this.mode = MOTION.LOCK;
                    this.t0 = now;
                    this.lockFrom = this.angle;
                }
                break;
            }
            case MOTION.LOCK: {
                // Защёлка: небольшой откат назад и возврат ровно в посадку.
                // Заодно снимает накопленную погрешность интегрирования.
                const u = Math.min(el / (c.lockMs / 1000), 1);
                const kick = (c.lockDeg * Math.PI / 180) * Math.sin(u * Math.PI) * (1 - u * 0.35);
                this.angle = this.plan.land + kick;
                this.velocity = 0;
                if (u >= 1) {
                    this.angle = this.plan.land;
                    this.mode = MOTION.WINNER;
                    this.t0 = now;
                    if (this.onSettle) this.onSettle();
                }
                break;
            }
            case MOTION.WINNER: {
                this.velocity = 0;
                if (el * 1000 > c.winnerMs) this.mode = MOTION.REST;
                break;
            }
            default:
                this.velocity = 0;
        }

        return { angle: this.angle, velocity: this.velocity, mode: this.mode };
    }

    /** Прогресс всей анимации 0..1 — для затемнения проигравших */
    get progress() {
        if (!this.plan || this.plan.skipped) return this.mode === MOTION.REST ? 0 : 1;
        const total = this.plan.tA + this.plan.tB + this.plan.tC;
        if (this.mode === MOTION.WINNER || this.mode === MOTION.REST) return 1;
        if (this.mode === MOTION.LOCK) return 1;
        return Math.min(1, this.#elapsedTotal() / total);
    }

    #elapsedTotal() {
        const p = this.plan;
        if (!p) return 0;
        switch (this.mode) {
            case MOTION.ACCEL: return 0;
            case MOTION.CRUISE: return p.tA;
            case MOTION.DECEL: return p.tA + p.tB;
            default: return p.tA + p.tB + p.tC;
        }
    }
}

/** ∫smootherstep du от 0 до u */
function integralSmoother(u) {
    return u * u * u * u * (u * (u * 1 - 3) + 2.5);   // = u^6 -3u^5 +2.5u^4
}



/* ── TicketModel.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — TicketModel
 *
 * Колесо строится из ТОГО ЖЕ массива билетов, который использовал
 * lottery-draw.js. Снимок пишется в rounds/<pool>-<date>.json в момент
 * розыгрыша — восстановить его из /round-stats после раунда нельзя,
 * потому что /round-complete уже проставил consumedInRound.
 *
 * Снимок:
 *   { total: 47, tickets: [["terra1abc", 10, 144, "legendary"], ...] }
 * Третий и четвёртый элементы пары необязательны: tokenId и тир нужны
 * колесу для картинки NFT и цвета редкости, механики не касаются.
 * Порядок пар — тот же обход активаций по usedAt, что и в скрипте.
 * Плоский индекс билета = позиция при разворачивании пар слева направо.
 *
 * MAX_SECTORS больше нет. Сектор = кошелёк, площадь пропорциональна числу
 * билетов, то есть площадь = вероятность выигрыша. Один кошелёк с 10
 * билетами занимает ровно столько же, сколько 10 кошельков по одному.
 *
 * Если кошельков всё равно слишком много — самые мелкие сходятся в один
 * групповой сектор, который раскрывается на остановке (expand()).
 */



class TicketModel {

    /**
     * @param {{total:number, tickets:Array<[string,number]>}} snapshot
     * @param {{maxSectors?:number, startAngle?:number}} [opts]
     */
    constructor(snapshot, opts = {}) {
        const pairs = normalizePairs(snapshot);

        this.maxSectors = opts.maxSectors ?? 48;
        this.startAngle = opts.startAngle ?? 0;

        this.total = pairs.reduce((s, p) => s + p[1], 0);
        this.pairs = pairs;

        // плоский индекс -> адрес; строится один раз, дальше O(1)
        this.indexToAddress = new Array(this.total);
        let cursor = 0;
        for (const [address, count] of pairs) {
            for (let i = 0; i < count; i++) this.indexToAddress[cursor++] = address;
        }

        this.#buildSectors();
    }

    /* ---------- построение секторов ---------- */

    #buildSectors() {
        // Слияние по кошельку. Порядок — первое появление в снимке,
        // он детерминирован (usedAt), поэтому колесо у всех одинаковое.
        const order = [];
        const byWallet = new Map();

        const RANK = { common: 0, rare: 1, legendary: 2 };
        this.pairs.forEach(([address, count, tokenId, tier]) => {
            if (!byWallet.has(address)) {
                byWallet.set(address, { address, entries: 0, indices: [], meta: {} });
                order.push(address);
            }
            const w = byWallet.get(address);
            w.entries += count;
            // показываем лучший тир кошелька и номер того же NFT
            if (tier && (RANK[tier] ?? -1) > (RANK[w.meta.tier] ?? -1)) {
                w.meta.tier = tier;
                w.meta.tokenId = tokenId;
            } else if (w.meta.tokenId == null && tokenId != null) {
                w.meta.tokenId = tokenId;
            }
        });

        // индексы каждого кошелька — для точного угла конкретного билета
        this.indexToAddress.forEach((address, i) => {
            byWallet.get(address).indices.push(i);
        });

        let wallets = order.map(a => byWallet.get(a));

        // Хвост: самые мелкие кошельки в один групповой сектор
        let group = null;
        if (wallets.length > this.maxSectors) {
            const keep = this.maxSectors - 1;
            const ranked = wallets.slice().sort((a, b) => b.entries - a.entries);
            const kept = new Set(ranked.slice(0, keep).map(w => w.address));
            const tail = wallets.filter(w => !kept.has(w.address));

            wallets = wallets.filter(w => kept.has(w.address));
            group = {
                address: null,
                meta: {},
                entries: tail.reduce((s, w) => s + w.entries, 0),
                indices: tail.flatMap(w => w.indices).sort((a, b) => a - b),
                meta: {},
                members: tail
            };
        }

        const list = group ? wallets.concat([group]) : wallets;

        // углы
        this.sectors = [];
        let angle = this.startAngle;
        list.forEach((w, i) => {
            const span = this.total > 0 ? (w.entries / this.total) * TAU : 0;
            const sector = {
                id: i,
                // Порядковый номер кошелька в раунде — по первому появлению
                // в снимке, то есть по usedAt. Одинаков у всех, кто открыл
                // страницу: считается из файла, а не из порядка отрисовки.
                number: i + 1,
                address: w.address,
                entries: w.entries,
                share: this.total > 0 ? w.entries / this.total : 0,
                startAngle: angle,
                endAngle: angle + span,
                span,
                isGroup: !!w.members,
                members: w.members || null,
                meta: w.meta || {},
                indices: w.indices
            };
            this.sectors.push(sector);
            angle += span;
        });

        // индекс -> сектор, тоже заранее
        this.indexToSector = new Array(this.total);
        this.sectors.forEach(s => {
            s.indices.forEach(i => { this.indexToSector[i] = s; });
        });
    }

    /* ---------- запросы ---------- */

    get sectorCount() { return this.sectors.length; }
    get hasGroup() { return this.sectors.some(s => s.isGroup); }

    /** Адрес по плоскому индексу билета. O(1) */
    addressForIndex(index) {
        return this.indexToAddress[index] ?? null;
    }

    /** Сектор по плоскому индексу билета. O(1) */
    sectorForIndex(index) {
        return this.indexToSector[index] ?? null;
    }

    sectorForAddress(address) {
        return this.sectors.find(s => s.address === address) || null;
    }

    /**
     * Точный угол центра конкретного билета внутри сектора его кошелька.
     * Билеты кошелька идут по возрастанию индекса, поэтому позиция
     * воспроизводима.
     */
    angleForIndex(index) {
        const sector = this.sectorForIndex(index);
        if (!sector) return null;
        const rank = sector.indices.indexOf(index);
        if (rank < 0) return sector.startAngle + sector.span / 2;
        const slice = sector.span / sector.entries;
        return sector.startAngle + slice * (rank + 0.5);
    }

    angleForSector(sector) {
        return sector ? sector.startAngle + sector.span / 2 : null;
    }

    /**
     * Предохранитель. Индекс — основа, адрес из winners.json — проверка.
     * Не сошлось — значит снимок не от этого раунда, крутить нельзя.
     */
    verify(index, address) {
        if (index === null || index === undefined) return false;
        if (index < 0 || index >= this.total) return false;
        return this.addressForIndex(index) === address;
    }

    /** Подмодель для раскрытия группового сектора */
    expand(sector) {
        if (!sector || !sector.isGroup) return null;
        return new TicketModel(
            {
                total: sector.entries,
                tickets: sector.members.map(w => [w.address, w.entries, w.meta && w.meta.tokenId, w.meta && w.meta.tier])
            },
            { maxSectors: this.maxSectors, startAngle: sector.startAngle }
        );
    }

    /** Локальный индекс внутри раскрытой группы */
    localIndex(sector, globalIndex) {
        if (!sector) return -1;
        return sector.indices.indexOf(globalIndex);
    }
}

/* ---------- вход ---------- */

function normalizePairs(snapshot) {
    if (!snapshot) return [];

    // [["addr", 10], ...]
    if (Array.isArray(snapshot.tickets) && Array.isArray(snapshot.tickets[0])) {
        return snapshot.tickets
            .map(p => [String(p[0]), Math.max(0, Number(p[1]) || 0), p[2] ?? null, p[3] ?? null])
            .filter(p => p[0] && p[1] > 0);
    }

    // ["addr","addr","addr", ...] — плоский массив, тоже принимаем
    if (Array.isArray(snapshot.tickets) && typeof snapshot.tickets[0] === "string") {
        const out = [];
        for (const address of snapshot.tickets) {
            const last = out[out.length - 1];
            if (last && last[0] === address) last[1]++;
            else out.push([address, 1]);
        }
        return out;
    }

    // [{address, entries}, ...]
    if (Array.isArray(snapshot.tickets)) {
        return snapshot.tickets
            .map(t => [String(t.address ?? t.wallet ?? ""), Number(t.entries ?? t.count ?? 0) || 0])
            .filter(p => p[0] && p[1] > 0);
    }

    return [];
}


/* ── WheelRenderer.js ─────────────────────────────────── */
/**
 * Oracle Draw — WheelRenderer
 *
 * Дирижёр. Владеет канвасом и DPR, держит кэш картинок NFT, собирает кадр
 * из остальных модулей. Сам ничего не решает про данные — ему дают
 * TicketModel и состояние анимации.
 *
 * Порядок слоёв:
 *   фон → звёзды → плита → сектора → рамка победителя → обод →
 *   искры обода → ядро → кристалл
 *
 * Почему canvas, а не SVG, как просил бриф: в том же брифе есть картинки
 * NFT внутри секторов (это PNG-маски) и сотни анимируемых частиц. Сотни
 * SVG-узлов, перерисовываемых каждый кадр, на среднем Android дают
 * заметные просадки — в этом проекте уже ловили ровно такое от
 * полноэкранных композитных слоёв. Canvas с масштабом по devicePixelRatio
 * даёт ту же резкость на любом экране. Гравировки и статичные детали при
 * желании можно положить сверху отдельным SVG-слоем — рендерер за
 * интерфейсом, замена не заденет остальное.
 */



const POINTER_ANGLE = -Math.PI / 2;

class WheelRenderer {

    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext("2d") : null;
        this.theme = getTheme(opts.pool || "daily");
        this.qualityKey = opts.quality || detectQuality();
        this.quality = QUALITY[this.qualityKey];

        this.model = null;
        this.angle = 0;
        this.winner = null;
        this.revealProgress = 0;      // 0..1 — насколько проигравшие погашены
        this.coreEnergy = 0;

        this.sectors = new WheelSector(this.theme);
        this.pointer = new WheelPointer(this.theme);
        this.center = new WheelCenter(this.theme);
        this.particles = new WheelParticles(opts.seed || 20260801);

        this._activeId = null;
        this._tick = 0;

        // Рендерер владеет своим циклом и своей физикой: снаружи его
        // просят «в холостую» / «раскручивайся» / «сядь на билет N».
        this.anim = new WheelAnimation();
        this.anim.reducedMotion = !!opts.reducedMotion || this.qualityKey === "still";
        this.onLanded = null;
        this._raf = null;

        this.resize();
    }

    /* ---------- настройка ---------- */

    setPool(pool) {
        this.theme = getTheme(pool);
        this.sectors.setTheme(this.theme);
        this.pointer.setTheme(this.theme);
        this.center.setTheme(this.theme);
        this.#rebuildParticles();
        return this;
    }

    setQuality(key) {
        this.qualityKey = key;
        this.quality = QUALITY[key] || QUALITY.medium;
        this.#rebuildParticles();
        return this;
    }

    setModel(model) {
        this.model = model;
        this.winner = null;
        this.revealProgress = 0;
        this._activeId = null;
        return this;
    }

    setWinner(sector) { this.winner = sector; return this; }

    /* ---------- цикл и управление ---------- */

    start() {
        if (this._raf !== null) return this;
        const loop = (now) => {
            this.anim.step(now);
            this.angle = this.anim.angle;
            if (this.winner) this.revealProgress = Math.min(1, this.revealProgress + 0.035);
            this.render(now, { intensity: this.anim.intensity, isSpinning: this.anim.isSpinning });
            this._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
        return this;
    }

    stop() {
        if (this._raf !== null) cancelAnimationFrame(this._raf);
        this._raf = null;
        return this;
    }

    /**
     * Шаг вручную — для превью и тестов без rAF.
     * Часы стартуют от now(), а не от нуля: spinToIndex ставит t0 по
     * performance.now(), и при отсчёте с нуля прошедшее время выходило
     * отрицательным — анимация не доходила до конца.
     */
    frame(dt = 1 / 60) {
        if (this._t === undefined) this._t = now();
        this._t += dt * 1000;
        this.anim.step(this._t);
        this.angle = this.anim.angle;
        if (this.winner) this.revealProgress = Math.min(1, this.revealProgress + 0.035);
        this.render(this._t, { intensity: this.anim.intensity, isSpinning: this.anim.isSpinning });
        return this;
    }

    idle() { this.anim.idle(now()); this.setWinner(null); this.revealProgress = 0; return this; }
    preDraw() { this.anim.predraw(now()); this.setWinner(null); this.revealProgress = 0; return this; }

    /**
     * Запустить розыгрыш до билета с плоским индексом index.
     * @returns {boolean} false, если индекс не разрешается в сектор
     */
    spinToIndex(index) {
        if (!this.model) return false;
        const target = this.model.angleForIndex(index);
        if (target === null || target === undefined) return false;
        this.setWinner(null);
        this.revealProgress = 0;
        this.anim.spinTo(now(), target, POINTER_ANGLE, () => {
            this.setWinner(this.model.sectorForIndex(index));
            this.pointer.strike();
            if (this.onLanded) this.onLanded();
        });
        return true;
    }

    /** Мгновенно поставить колесо на билет — без анимации */
    snapToIndex(index) {
        if (!this.model) return false;
        const target = this.model.angleForIndex(index);
        if (target === null || target === undefined) return false;
        this.angle = POINTER_ANGLE - target;
        this.anim.angle = this.angle;
        this.anim.rest();
        this.setWinner(this.model.sectorForIndex(index));
        this.revealProgress = 1;
        return true;
    }
    setAngle(a) { this.angle = a; return this; }

    resize() {
        if (!this.canvas) return this;
        const dpr = Math.min(window.devicePixelRatio || 1, this.qualityKey === "high" ? 2 : 1.5);
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width || this.canvas.width || 500;
        const cssH = rect.height || this.canvas.height || cssW;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.dpr = dpr;
        this._cssW = this.canvas.clientWidth || cssW;
        this.#rebuildParticles();
        return this;
    }

    #rebuildParticles() {
        const n = Math.round(this.theme.particles.count * (this.quality?.particles ?? 0));
        const stars = Math.round(140 * (this.quality?.stars ?? 0));
        this.particles.build(Math.max(n, 1), Math.max(stars, 1));
    }

    /* ---------- кадр ---------- */

    /**
     * @param {number} t     время в мс (performance.now)
     * @param {object} anim  {intensity, progress, isSpinning}
     */
    render(t, anim = {}) {
        const ctx = this.ctx;
        if (!ctx || !this.canvas) return;

        // Вкладка Draw может быть скрыта на момент загрузки: тогда канвас
        // имеет нулевой размер, и без этой проверки колесо так и осталось бы
        // в аварийном размере. Заодно ловит поворот экрана и смену вкладки.
        const live = this.canvas.clientWidth;
        if (live && Math.abs(live - (this._cssW || 0)) > 1) {
            this._cssW = live;
            this.resize();
            return;                      // следующий кадр отрисует уже в новом размере
        }

        const W = this.canvas.width, H = this.canvas.height;
        const cx = W / 2, cy = H / 2;
        const ringW = Math.min(W, H) * this.theme.ring.width;
        const rOuter = Math.min(W, H) / 2 - 4;
        const rFace = rOuter - ringW;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);

        // Фон и звёзды обрезаны по кругу колеса. Раньше cosmicBackdrop
        // заливал весь прямоугольник, и на странице колесо выглядело
        // вырезанным из чёрного квадрата.
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, 0, TAU);
        ctx.clip();
        Glow.cosmicBackdrop(ctx, W, H, this.theme);
        this.particles.drawStars(ctx, W, H, t, this.quality);
        ctx.restore();

        Glow.facePlate(ctx, cx, cy, rFace, this.theme);

        const active = this.#activeSector();
        this.#detectTick(active, t);

        if (!this.model || !this.model.sectors.length) {
            this.#emptyFace(ctx, cx, cy, rFace);
        }

        if (this.model) {
            for (const s of this.model.sectors) {
                const isWinner = this.winner && s.id === this.winner.id;
                const dim = this.winner
                    ? (isWinner ? 1 : 1 - (1 - this.theme.winner.dim) * this.revealProgress)
                    : 1;
                const scale = isWinner ? 1 + this.theme.winner.grow * this.revealProgress : 1;
                const act = (active && active.id === s.id && !this.winner)
                    ? 1 : (isWinner ? 1 : 0);
                this.sectors.draw(ctx, cx, cy, rFace, s,
                    { angle: this.angle, dim, scale, active: act, winner: isWinner, t }, this.quality);
            }
            if (this.winner && this.revealProgress > 0.05) {
                this.sectors.drawWinnerFrame(ctx, cx, cy, rFace, this.winner, this.angle, t, this.quality);
                this.particles.drawWinnerSparks(
                    ctx, cx, cy, rFace,
                    this.angle + this.winner.startAngle, this.winner.span,
                    this.theme, t, this.quality
                );
            }
        }

        Glow.brushedRing(ctx, cx, cy, rOuter, ringW, this.theme, t);
        if (this.quality.engravings) this.#engravings(ctx, cx, cy, rOuter, ringW, t);
        if (this.quality.reflections) Glow.ringReflections(ctx, cx, cy, rOuter, ringW, this.theme, t);
        Glow.ringPulse(ctx, cx, cy, rOuter, this.theme, t, this.quality);
        this.particles.drawRing(ctx, cx, cy, rOuter - ringW * 0.15, rOuter - ringW * 0.9,
            this.theme, t, this.quality, this.angle);

        this.coreEnergy += ((anim.isSpinning ? 1 : 0.15) - this.coreEnergy) * 0.05;
        this.center.draw(ctx, cx, cy, rFace, t, this.quality, this.coreEnergy);

        this.pointer.draw(ctx, cx, cy, rOuter, t,
            anim.intensity ?? 0, this.quality, this._tick);
        this._tick *= 0.86;
    }

    /** Раунд без участников — колесо крутится, но сектора пустые */
    #emptyFace(ctx, cx, cy, r) {
        const th = this.theme;
        const n = 12;
        const span = TAU / n;

        for (let i = 0; i < n; i++) {
            const a0 = this.angle + i * span;
            const a1 = a0 + span;

            // Пустые сектора всё равно рисуем: колесо должно читаться как
            // колесо, а не как пустой круг. Чередование через один даёт
            // объём, не привлекая внимания.
            const g = ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, r);
            g.addColorStop(0, "rgba(255,255,255,0.015)");
            g.addColorStop(1, i % 2 ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.018)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, a0, a1);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = th.spoke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a0) * r * 0.30, cy + Math.sin(a0) * r * 0.30);
            ctx.lineTo(cx + Math.cos(a0) * r * 0.99, cy + Math.sin(a0) * r * 0.99);
            ctx.stroke();
        }

        // тонкая дуга по краю — граница поля секторов
        ctx.strokeStyle = th.spoke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.985, 0, TAU);
        ctx.stroke();

        ctx.save();
        ctx.fillStyle = th.text.secondary;
        ctx.globalAlpha = 0.75;
        ctx.font = `${Math.round(r * 0.068)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Awaiting entries", cx, cy + r * 0.60);
        ctx.font = `${Math.round(r * 0.05)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.globalAlpha = 0.45;
        ctx.fillText("Mint an NFT to take a sector", cx, cy + r * 0.72);
        ctx.restore();
    }

    /** Гравировки по ободу — статичны относительно колеса, едут вместе с ним */
    #engravings(ctx, cx, cy, r, w, t) {
        const n = 24;
        ctx.save();
        ctx.strokeStyle = this.theme.engraving;
        ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) {
            const a = this.angle * 0.25 + (i / n) * TAU;
            const rr = r - w * 0.5;
            const len = (i % 4 === 0) ? w * 0.34 : w * 0.18;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (rr - len / 2), cy + Math.sin(a) * (rr - len / 2));
            ctx.lineTo(cx + Math.cos(a) * (rr + len / 2), cy + Math.sin(a) * (rr + len / 2));
            ctx.stroke();
            if (i % 6 === 0) {
                ctx.beginPath();
                ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, w * 0.09, 0, TAU);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    /** Какой сектор сейчас под кристаллом */
    #activeSector() {
        if (!this.model || !this.model.sectors.length) return null;
        const a = (((POINTER_ANGLE - this.angle) % TAU) + TAU) % TAU;
        for (const s of this.model.sectors) {
            const start = ((s.startAngle % TAU) + TAU) % TAU;
            const end = start + s.span;
            if ((a >= start && a < end) || (end > TAU && a < end - TAU)) return s;
        }
        return null;
    }

    /** Смена сектора под кристаллом = короткий тик яркости */
    #detectTick(active, t) {
        const id = active ? active.id : null;
        if (id !== this._activeId) {
            this._activeId = id;
            this._tick = 1;
        }
    }

    get pointerAngle() { return POINTER_ANGLE; }
}

function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}



/* ── Config.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — Config
 * Единственное место, где лежат числа и строки. Ничего не хардкодим в модулях.
 */

const CONFIG = {

    /* ---------- источник данных ---------- */

    // Абсолютный путь от корня сайта. Относительный "./winners.json" резолвится
    // от URL СТРАНИЦЫ, а не от модуля — на вложенных страницах это ломается.
    WINNERS_JSON: "/winners.json",

    // Снимок билетов на момент розыгрыша. {round} — это round_id из
    // winners.json (daily_2026-08-01), тот же, с которым его пишет скрипт.
    // Пишется lottery-draw.js; без него колесо работает в legacy-режиме.
    ROUND_SNAPSHOT: "/rounds/{round}.json",

    // Таймаут одного запроса
    FETCH_TIMEOUT: 10000,

    /* ---------- пулы ---------- */

    DAILY: "daily",
    WEEKLY: "weekly",

    /* ---------- расписание (всё в UTC — как cron "0 20 * * *") ---------- */

    DRAW_HOUR_UTC: 20,
    DRAW_MINUTE_UTC: 0,

    // 1 = понедельник. В lottery-draw.yml понедельник UTC = weekly.
    WEEKLY_WEEKDAY_UTC: 1,

    // В понедельник daily не разыгрывается (тот же cron уходит в weekly).
    // Если когда-нибудь разведёшь их по разным cron — поставь false.
    DAILY_SKIPS_WEEKLY_DAY: true,

    /* ---------- опрос ---------- */

    POLL_IDLE: 60000,        // вне окна розыгрыша
    POLL_ACTIVE: 5000,       // в окне розыгрыша
    POLL_HIDDEN: 300000,     // вкладка спрятана

    ACTIVE_BEFORE_MS: 5 * 60 * 1000,    // за сколько до дедлайна ускоряемся
    ACTIVE_AFTER_MS: 20 * 60 * 1000,    // сколько ждём после (GitHub Action не мгновенный)

    /* ---------- фазы ---------- */

    LOCK_MS: 15 * 60 * 1000,            // T-15м: приём NFT закрыт (LOCKED)
    PRE_DRAW_MS: 30 * 1000,             // T-30с: PRE_DRAW, колесо раскручивается
    AWAIT_TIMEOUT_MS: 10 * 60 * 1000,   // сколько ждать публикацию, потом отпускаем
    REVEAL_WINDOW_MS: 60 * 60 * 1000,   // сколько держать результат на колесе

    /* ---------- колесо ---------- */

    // Видимых секторов. MAX_SECTORS=20 из старого app.js больше нет:
    // сектор = кошелёк, площадь = доля билетов. Этот предел включает
    // только схлопывание мелкого хвоста в один раскрываемый сектор.
    MAX_SECTORS: 48,

    IDLE_RPM: 4,                        // холостое вращение в PRE_DRAW/AWAITING
    SPIN_TURNS_MIN: 5,
    SPIN_TURNS_MAX: 8,
    SPIN_DURATION: 6500,
    REVEAL_HOLD: 2200,                  // пауза на подсветке перед карточкой
    GROUP_REVEAL_MS: 1600,              // раскрытие хвостового сектора

    /* ---------- анимация ---------- */

    // Если при первой загрузке результат старше этого — колесо НЕ крутим,
    // просто рисуем итог. Иначе каждый заход на сайт = анимация вчерашнего раунда.
    FRESH_RESULT_MS: 30 * 60 * 1000,

    STORAGE_KEY: "oracleDraw.v2.seen",
    STORAGE_LIMIT: 60,

    /* ---------- устойчивость ---------- */

    MAX_BACKOFF_STEPS: 5,               // экспоненциальный откат при ошибках сети

    DEBUG: false                        // включается ?draw-v2-debug в URL
};

export default CONFIG;


/* ── DrawClock.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — DrawClock
 * Вся арифметика времени в одном месте, строго в UTC.
 *
 * ВАЖНО: round_id здесь НЕ вычисляется. В winners.json он сдвинут на день
 * вперёд (getCurrentRoundId зовётся уже после 20:00), и любая своя формула
 * разъедется с файлом. Сравниваем только строки round_id из самого файла.
 */


const DAY = 86400000;

/** Метка 20:00 UTC того календарного дня (UTC), в который попадает ts */
function deadlineOfDay(ts) {
    const d = new Date(ts);
    return Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        CONFIG.DRAW_HOUR_UTC,
        CONFIG.DRAW_MINUTE_UTC,
        0, 0
    );
}

/** Разыгрывается ли этот пул в день, на который приходится дедлайн */
function poolRunsAt(pool, deadlineTs) {
    const isWeeklyDay = new Date(deadlineTs).getUTCDay() === CONFIG.WEEKLY_WEEKDAY_UTC;
    if (pool === CONFIG.WEEKLY) return isWeeklyDay;
    return CONFIG.DAILY_SKIPS_WEEKLY_DAY ? !isWeeklyDay : true;
}

/** Ближайший будущий дедлайн пула (мс) */
function nextDeadline(pool, now = Date.now()) {
    for (let i = 0; i <= 8; i++) {
        const ts = deadlineOfDay(now + i * DAY);
        if (ts > now && poolRunsAt(pool, ts)) return ts;
    }
    return null;
}

/** Последний прошедший дедлайн пула (мс) */
function prevDeadline(pool, now = Date.now()) {
    for (let i = 0; i <= 8; i++) {
        const ts = deadlineOfDay(now - i * DAY);
        if (ts <= now && poolRunsAt(pool, ts)) return ts;
    }
    return null;
}

/** Мы в "горячем" окне вокруг розыгрыша? */
function inActiveWindow(pool, now = Date.now()) {
    const next = nextDeadline(pool, now);
    const prev = prevDeadline(pool, now);
    if (next !== null && next - now <= CONFIG.ACTIVE_BEFORE_MS) return true;
    if (prev !== null && now - prev <= CONFIG.ACTIVE_AFTER_MS) return true;
    return false;
}

/** Мс до следующего дедлайна (для обратного отсчёта) */
function msToNextDeadline(pool, now = Date.now()) {
    const next = nextDeadline(pool, now);
    return next === null ? null : next - now;
}

/** "05:12:44" из миллисекунд — для UI, чтобы не считать в трёх местах */
function formatCountdown(ms) {
    if (ms === null || ms < 0) ms = 0;
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}


/* ── DrawPhase.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — DrawPhase
 *
 * Одна фаза управляет всем. Ни таймер, ни колесо, ни popup не держат
 * собственного состояния — они читают фазу.
 *
 *   OPEN ──T-15м──> LOCKED ──T-30с──> PRE_DRAW ──дедлайн──> AWAITING
 *                                                              │
 *                          результат есть ──────────────────────┤
 *                                                              ▼
 *                                            REVEALING ──> REVEALED
 *                                                              │
 *                                       раунд пропущен ──> ROLLOVER
 *
 * Флаги animation / replay / revealed сюда не нужны: они выводятся из
 * фазы. Два источника правды — это ровно та ошибка, из-за которой
 * currentLottery и selectedPool разъезжались при минте.
 */

const PHASE = {
    OPEN: "OPEN",           // приём NFT открыт
    LOCKED: "LOCKED",       // последние минуты, приём закрыт
    PRE_DRAW: "PRE_DRAW",   // Oracle просыпается, колесо раскручивается вхолостую
    AWAITING: "AWAITING",   // дедлайн прошёл, ждём публикации результата
    REVEALING: "REVEALING", // идёт финальная анимация
    REVEALED: "REVEALED",   // результат показан
    ROLLOVER: "ROLLOVER"    // раунд не состоялся, билеты переходят дальше
};

/** Можно ли крутить/менять данные в этой фазе */
const PHASE_RULES = {
    [PHASE.OPEN]: { entriesOpen: true, wheelIdle: false, showsResult: false },
    [PHASE.LOCKED]: { entriesOpen: false, wheelIdle: false, showsResult: false },
    [PHASE.PRE_DRAW]: { entriesOpen: false, wheelIdle: true, showsResult: false },
    [PHASE.AWAITING]: { entriesOpen: false, wheelIdle: true, showsResult: false },
    [PHASE.REVEALING]: { entriesOpen: false, wheelIdle: false, showsResult: false },
    [PHASE.REVEALED]: { entriesOpen: false, wheelIdle: false, showsResult: true },
    [PHASE.ROLLOVER]: { entriesOpen: true, wheelIdle: false, showsResult: false }
};

/**
 * Вычисление фазы. Чистая функция — её легко прогнать тестом на любой
 * момент времени, не дожидаясь 20:00.
 *
 * @param {object} ctx
 * @param {number} ctx.now
 * @param {number|null} ctx.deadline      ближайший дедлайн пула
 * @param {number|null} ctx.lastDeadline  последний прошедший дедлайн
 * @param {object|null} ctx.result        нормализованный раунд или null
 * @param {boolean} ctx.revealing         сейчас крутится финальная анимация
 * @param {object} ctx.cfg                LOCK_MS / PRE_DRAW_MS / AWAIT_TIMEOUT_MS
 */
function derivePhase(ctx) {
    const { now, deadline, lastDeadline, result, revealing, cfg } = ctx;

    if (revealing) return PHASE.REVEALING;

    const covers = resultCovers(result, lastDeadline);

    // REVEALED держим ограниченное время после дедлайна. Иначе результат
    // вчерашнего раунда висит на колесе до следующих 20:00, вместо того
    // чтобы показывать отсчёт до нового розыгрыша.
    const withinReveal = lastDeadline === null ||
        (now - lastDeadline) <= (cfg.REVEAL_WINDOW_MS || 60 * 60 * 1000);

    if (covers && withinReveal) return result.skipped ? PHASE.ROLLOVER : PHASE.REVEALED;

    if (lastDeadline !== null) {
        const since = now - lastDeadline;
        // Результата за прошедший дедлайн ещё нет — ждём, но не вечно
        if (since >= 0 && since <= cfg.AWAIT_TIMEOUT_MS) return PHASE.AWAITING;
    }

    if (deadline !== null) {
        const left = deadline - now;
        if (left <= cfg.PRE_DRAW_MS) return PHASE.PRE_DRAW;
        if (left <= cfg.LOCK_MS) return PHASE.LOCKED;
    }

    return PHASE.OPEN;
}

/** Относится ли результат к последнему прошедшему дедлайну */
function resultCovers(result, lastDeadline) {
    if (!result) return false;
    if (lastDeadline === null) return true;
    if (result.drawnAt === null || result.drawnAt === undefined) return false;
    // допуск: block_time может быть на минуту раньше метки 20:00
    return result.drawnAt >= lastDeadline - 5 * 60 * 1000;
}

/** Человекочитаемая подпись фазы — один словарь вместо строк по всему UI */
const PHASE_TEXT = {
    [PHASE.OPEN]: { title: "Next draw in {t}", sub: "Wheel spins automatically at 20:00 UTC" },
    [PHASE.LOCKED]: { title: "Entries close in {t}", sub: "Last chance to enter this round" },
    [PHASE.PRE_DRAW]: { title: "Oracle is reading the blockchain...", sub: "Round closed · {t} to the block" },
    [PHASE.AWAITING]: { title: "Oracle is reading the blockchain...", sub: "Waiting for the on-chain result" },
    [PHASE.REVEALING]: { title: "Selecting winner", sub: "Landing on ticket #{i}" },
    [PHASE.REVEALED]: { title: "Winner Selected", sub: "Payout sent automatically" },
    [PHASE.ROLLOVER]: { title: "Round rolled over", sub: "Not enough entries — tickets stay active" }
};


/* ── DrawState.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — DrawState
 * Состояние пула. Фаза здесь одна и единственная — производных флагов
 * (animation / replay / revealed) нет, они выводятся из неё.
 */


const safeStorage = {
    read(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    write(key, value) { try { window.localStorage.setItem(key, value); } catch { /* ignore */ } }
};

class DrawState {

    constructor(pool = CONFIG.DAILY) {
        this.reset(pool);
    }

    reset(pool = this.pool) {
        this.pool = pool;
        this.phase = PHASE.OPEN;
        this.roundKey = null;
        this.round = null;
        this.model = null;          // TicketModel текущего раунда
        this.verified = false;      // winner_index сошёлся с адресом
        this.hydrated = false;
        this.revealing = false;
        this.lastUpdateAt = 0;
        this.lastError = null;
    }

    applyRound(round, model, verified) {
        this.round = round;
        this.roundKey = round.key;
        this.model = model || null;
        this.verified = !!verified;
    }

    get rules() { return PHASE_RULES[this.phase] || PHASE_RULES[PHASE.OPEN]; }

    /* ---------- память просмотренных раундов ---------- */

    #seen() {
        const raw = safeStorage.read(CONFIG.STORAGE_KEY);
        if (!raw) return [];
        try { const l = JSON.parse(raw); return Array.isArray(l) ? l : []; } catch { return []; }
    }

    hasSeen(key) { return this.#seen().includes(key); }

    markSeen(key) {
        const list = this.#seen();
        if (list.includes(key)) return;
        list.push(key);
        while (list.length > CONFIG.STORAGE_LIMIT) list.shift();
        safeStorage.write(CONFIG.STORAGE_KEY, JSON.stringify(list));
    }

    snapshot() {
        const r = this.round;
        return {
            pool: this.pool,
            phase: this.phase,
            round: r ? r.key : null,
            date: r ? r.date : null,
            entriesOpen: this.rules.entriesOpen,
            showsResult: this.rules.showsResult,
            winner: r ? r.winner : null,
            winnerIndex: r ? r.winnerIndex : null,
            prize: r ? r.prize : 0,
            winners: r ? r.winners.slice() : [],
            skipped: r ? r.skipped : false,
            sectors: this.model ? this.model.sectorCount : 0,
            tickets: this.model ? this.model.total : 0,
            verified: this.verified
        };
    }
}



/* ── DrawEvents.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — Event Bus
 *
 * Отличия от наивной версии:
 *  - off() и once() — иначе при switchLottery подписки копятся и колесо
 *    крутится по два-три раза на один результат;
 *  - каждый слушатель в своём try/catch — упавшая анимация не должна
 *    убивать popup, нотификацию и всё, что подписалось после неё;
 *  - "*" — подписка на все события (удобно для отладки).
 */

const EVENTS = {
    READY: "READY",                   // первый успешный load, базовая линия выставлена
    DATA_UPDATED: "DATA_UPDATED",     // winners.json изменился
    ROUND_CHANGED: "ROUND_CHANGED",   // сменился round_id текущего пула
    RESULT_READY: "RESULT_READY",     // результат доступен — отрисовать статично
    DRAW_FINISHED: "DRAW_FINISHED",   // КРУТИТЬ КОЛЕСО (только когда это уместно)
    DRAW_SKIPPED: "DRAW_SKIPPED",     // раунд не состоялся (мало билетов и т.п.)
    PHASE_CHANGED: "PHASE_CHANGED",   // OPEN → LOCKED → PRE_DRAW → AWAITING → REVEALING → REVEALED
    TICK: "TICK",                     // раз в секунду, для обратного отсчёта
    ERROR: "ERROR"                    // сеть/парсинг
};

class DrawEvents {

    constructor() {
        this.listeners = Object.create(null);
    }

    on(event, callback) {
        if (typeof callback !== "function") return () => {};
        (this.listeners[event] ||= []).push(callback);
        return () => this.off(event, callback);   // возвращаем "отписку"
    }

    once(event, callback) {
        const wrapper = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        return this.on(event, wrapper);
    }

    off(event, callback) {
        const list = this.listeners[event];
        if (!list) return;
        if (!callback) {
            delete this.listeners[event];
            return;
        }
        const i = list.indexOf(callback);
        if (i !== -1) list.splice(i, 1);
    }

    emit(event, data) {
        const run = (fn, payload) => {
            try {
                fn(payload);
            } catch (err) {
                console.error(`[DrawEvents] listener failed on ${event}:`, err);
            }
        };

        // копия массива: слушатель может отписаться прямо в обработчике
        (this.listeners[event] || []).slice().forEach(fn => run(fn, data));
        (this.listeners["*"] || []).slice().forEach(fn => run(fn, { event, data }));
    }

    clear() {
        this.listeners = Object.create(null);
    }
}


/* ── DrawAPI.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — DrawAPI
 *
 * Схема winners.json взята из рабочего loadWinners() в app.js:
 *   daily : { date, winner, prize_lunc, entries, block_hash, block_height,
 *             winner_index, tx_winner, skipped }
 *   weekly: { date, winners:[{place, address, amount_lunc, tx}], entries,
 *             block_hash, block_height, tx_treasury, skipped }
 *
 * ВАЖНО: round_id в файле НЕТ — идентификатор раунда собираем как
 * "pool:date". Первая версия этого модуля искала round_id и молча
 * отбросила бы все записи.
 */


/** Идентификатор раунда: "daily:2026-07-24" */
function makeKey(raw, pool, index) {
    if (raw.round_id) return String(raw.round_id);
    if (raw.date) return `${pool}:${raw.date}`;
    return `${pool}:#${index}`;
}

/** Момент розыгрыша: дата из файла + 20:00 UTC */
function drawMoment(raw) {
    if (raw.block_time) {
        const t = Date.parse(raw.block_time);
        if (!Number.isNaN(t)) return t;
    }
    if (raw.date) {
        const hh = String(CONFIG.DRAW_HOUR_UTC).padStart(2, "0");
        const t = Date.parse(`${raw.date}T${hh}:00:00Z`);
        if (!Number.isNaN(t)) return t;
    }
    return null;
}

function normalizeRound(raw, pool, index) {
    if (!raw || typeof raw !== "object") return null;

    const key = makeKey(raw, pool, index);

    // weekly: массив мест
    let winners = [];
    if (Array.isArray(raw.winners) && raw.winners.length) {
        winners = raw.winners.map((w, i) => ({
            place: w.place ?? i + 1,
            address: w.address ?? w.winner ?? null,
            prize: Number(w.amount_lunc ?? w.prize_lunc ?? 0) || 0,
            tx: w.tx ?? null,
            index: Number.isFinite(Number(w.winner_index)) ? Number(w.winner_index) : null
        })).filter(w => w.address);
    } else if (raw.winner) {
        winners = [{
            place: 1,
            address: raw.winner,
            prize: Number(raw.prize_lunc ?? raw.prize ?? 0) || 0,
            tx: raw.tx_winner ?? null,
            index: Number.isFinite(Number(raw.winner_index)) ? Number(raw.winner_index) : null
        }];
    }

    const skipped = raw.skipped === true || winners.length === 0;
    const first = winners[0] || null;

    return {
        key,
        pool,
        date: raw.date ?? null,
        skipped,
        reason: raw.reason ?? null,

        winner: first ? first.address : null,
        winnerIndex: first ? first.index : null,
        prize: first ? first.prize : 0,
        winners,

        entries: Number(raw.entries ?? 0) || 0,
        participants: Number(raw.participants ?? 0) || 0,

        blockHash: raw.block_hash ?? null,
        blockHeight: raw.block_height ?? null,
        randomness: raw.randomness ?? null,
        txTreasury: raw.tx_treasury ?? null,

        drawnAt: drawMoment(raw),
        raw
    };
}

class DrawAPI {

    constructor(url = CONFIG.WINNERS_JSON) {
        this.url = url;
        this.lastText = null;
        this.lastPayload = null;
    }

    /**
     * @returns {Promise<object|null>} null = файл не изменился с прошлого раза
     */
    async load({ force = false } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);

        let text;
        try {
            const res = await fetch(`${this.url}?t=${Date.now()}`, {
                cache: "no-store",
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`winners.json HTTP ${res.status}`);
            text = await res.text();
        } catch (err) {
            if (err.name === "AbortError") throw new Error("winners.json timeout");
            throw err;
        } finally {
            clearTimeout(timer);
        }

        if (!force && text === this.lastText) return null;

        let json;
        try {
            json = JSON.parse(text);
        } catch {
            throw new Error("winners.json: невалидный JSON");
        }

        this.lastText = text;
        this.lastPayload = {
            daily: this.#list(json[CONFIG.DAILY], CONFIG.DAILY),
            weekly: this.#list(json[CONFIG.WEEKLY], CONFIG.WEEKLY),
            meta: json._meta ?? null,
            fetchedAt: Date.now()
        };
        return this.lastPayload;
    }

    /**
     * Снимок билетов раунда. Возвращает null, если файла нет —
     * у старых раундов его не будет, это не ошибка.
     */
    async loadSnapshot(roundKey) {
        if (!roundKey) return null;
        const cacheKey = roundKey;
        this._snapshots ||= new Map();
        if (this._snapshots.has(cacheKey)) return this._snapshots.get(cacheKey);

        const url = CONFIG.ROUND_SNAPSHOT.replace("{round}", encodeURIComponent(roundKey));
        try {
            const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
            if (!res.ok) { this._snapshots.set(cacheKey, null); return null; }
            const json = await res.json();
            this._snapshots.set(cacheKey, json);
            return json;
        } catch {
            this._snapshots.set(cacheKey, null);
            return null;
        }
    }

    #list(arr, pool) {
        if (!Array.isArray(arr)) return [];
        return arr.map((item, i) => normalizeRound(item, pool, i)).filter(Boolean);
    }

    /**
     * Самый свежий раунд. Сортируем по drawnAt — порядок в файле
     * гарантировать нельзя, а даты сравнимы всегда.
     */
    static pickLatest(list) {
        if (!Array.isArray(list) || list.length === 0) return null;
        return list.reduce((best, cur) => {
            if (!best) return cur;
            return (cur.drawnAt ?? 0) > (best.drawnAt ?? 0) ? cur : best;
        }, null);
    }
}


/* ── DrawEngine.js ─────────────────────────────────── */
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


class DrawEngine {

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


/* ── DrawScheduler.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — DrawScheduler
 *
 * Один секундный таймер вместо частокола setInterval.
 * Каждую секунду: tick() для обратного отсчёта, и решение — пора ли в сеть.
 *
 * Почему не setInterval(update, 5000):
 *  - 17 280 запросов в сутки с каждой открытой вкладки, притом что файл
 *    меняется раз в день;
 *  - вкладка в фоне на мобиле всё равно тротлится браузером — лучше явно
 *    уйти в редкий режим и сделать мгновенную проверку при возврате;
 *  - двойной start() давал два независимых таймера.
 */


class DrawScheduler {

    constructor(engine) {
        this.engine = engine;
        this.timer = null;
        this.lastPoll = 0;
        this.running = false;

        this.onVisibility = () => {
            if (!document.hidden) this.pollNow();
        };
        this.onOnline = () => this.pollNow();
    }

    start() {
        if (this.running) return;         // защита от двойного запуска
        this.running = true;

        document.addEventListener("visibilitychange", this.onVisibility);
        window.addEventListener("online", this.onOnline);

        this.pollNow();                   // первый запрос сразу, не через 5 секунд

        this.timer = setInterval(() => {
            const now = Date.now();
            this.engine.tick();

            const interval = this.engine.pollInterval(document.hidden);
            if (now - this.lastPoll >= interval) this.pollNow();
        }, 1000);
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        clearInterval(this.timer);
        this.timer = null;
        document.removeEventListener("visibilitychange", this.onVisibility);
        window.removeEventListener("online", this.onOnline);
    }

    /** Внеочередной опрос (возврат на вкладку, кнопка Refresh, после минта) */
    pollNow(opts) {
        this.lastPoll = Date.now();
        return this.engine.update(opts);
    }
}


/* ── DrawBridge.js ─────────────────────────────────── */
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


class DrawBridge {

    constructor(engine) {
        this.engine = engine;
        this.wheel = null;
        this.queue = [];
        this.round = null;
        this.lastCard = null;
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
        // Переключение пула или страницы прячет карточку средствами app.js —
        // возвращаем её из текущего состояния, а не только на первой загрузке.
        on(EVENTS.DATA_UPDATED, () => this.syncCard());
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
    /**
     * Привести карточку победителя в соответствие с текущим раундом.
     * switchLottery в app.js ставит ей display:none, и без этого она
     * не возвращалась до перезагрузки страницы.
     */
    syncCard() {
        const ui = this.ui;
        if (!ui || !ui.card) return;
        if (this.engine.state.revealing) return;

        const round = this.engine.state.round;
        if (!round || round.skipped || !round.winners.length) { this.lastCard = null; return; }

        const w = round.winners[0];
        this.lastCard = {
            address: w.address, prize: w.prize, tx: w.tx,
            label: round.winners.length > 1 ? "1st Place" : null
        };
        ui.card(this.lastCard);
    }

    /**
     * Держать карточку победителя в актуальном виде.
     *
     * Зовётся каждую секунду и сама решает, надо ли что-то делать:
     *  - карточки нет, а победитель в состоянии есть → показать;
     *  - карточку спрятал switchLottery из app.js → вернуть;
     *  - всё на месте → выйти, ничего не трогая (иначе CSS-анимация
     *    появления перезапускалась бы каждую секунду).
     *
     * Через события это не решается: DATA_UPDATED движок эмитит ДО того,
     * как подставит раунд в state, а следующий раз он придёт только при
     * изменении winners.json — раз в сутки.
     */
    ensureCard() {
        if (this.engine.state.revealing) return;

        const round = this.engine.state.round;
        if (!round || round.skipped || !round.winners.length) return;

        const el = document.getElementById("wheel-winner-card");
        if (!el) return;

        const hidden = !el.style.display || el.style.display === "none";
        if (this.lastCard && !hidden) return;

        this.syncCard();
    }

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
        this.ensureCard();
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
                this.lastCard = {
                    address: w.address, prize: w.prize, tx: w.tx,
                    label: this.round.winners.length > 1 ? placeLabel(w.place) : null
                };
                this.ui.card(this.lastCard);
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


/* ── index.js ─────────────────────────────────── */
/**
 * Oracle Draw V2 — точка входа.
 *
 * Ничего не ломает в старом app.js: только читает winners.json и эмитит
 * события. Пока к ним никто не подписан — система работает вхолостую.
 *
 * Подключение (index.html, ПОСЛЕ старых скриптов):
 *   <script type="module" src="/assets/js/draw-v2/index.js?v=1"></script>
 *
 * Отладка: открыть страницу с ?draw-v2-debug — в консоли будет весь поток
 * событий, а window.oracleDrawV2 даст ручной доступ.
 */


if (new URLSearchParams(location.search).has("draw-v2-debug")) {
    CONFIG.DEBUG = true;
}

// Стартуем с того пула, который открыт на странице (вкладки старого app.js)
const initialPool = (window.currentLottery === CONFIG.WEEKLY) ? CONFIG.WEEKLY : CONFIG.DAILY;

const engine = new DrawEngine(initialPool);
const scheduler = new DrawScheduler(engine);
const bridge = new DrawBridge(engine).attach();

// Пока снимка билетов нет (старые раунды, или lottery-draw.js ещё не
// обновлён) — колесо остаётся за старым рендером app.js. Как только
// модель построена, канвас переходит к V2.
engine.on(EVENTS.RESULT_READY, ({ model }) => {
    if (model && model.total > 0 && window.oracleDrawV2) window.oracleDrawV2.ownsWheel = true;
});

if (CONFIG.DEBUG) {
    engine.on("*", ({ event, data }) => {
        if (event === EVENTS.TICK) return;              // не засоряем консоль
        console.log(`%c[DrawV2] ${event}`, "color:#7ec8ff", data);
    });
}

window.oracleDrawV2 = {
    ownsWheel: false,
    engine,
    scheduler,
    bridge,
    CONFIG,
    EVENTS,
    PHASE,
    utils: { formatCountdown, nextDeadline, prevDeadline },

    // короткие обёртки для консоли и для будущего UI
    on: (e, cb) => engine.on(e, cb),
    off: (e, cb) => engine.off(e, cb),
    refresh: () => scheduler.pollNow({ force: true }),
    refreshLive: () => bridge.refreshLive(),
    setPool: (p) => engine.setPool(p),
    replay: () => engine.replay(),
    model: () => engine.model,
    phase: () => engine.phase,
    state: () => engine.snapshot(),
    history: () => engine.history()
};

// стартуем последним: к этому моменту window.oracleDrawV2 уже есть
scheduler.start();


