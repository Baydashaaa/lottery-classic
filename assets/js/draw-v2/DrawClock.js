/**
 * Oracle Draw V2 — DrawClock
 * Вся арифметика времени в одном месте, строго в UTC.
 *
 * ВАЖНО: round_id здесь НЕ вычисляется. В winners.json он сдвинут на день
 * вперёд (getCurrentRoundId зовётся уже после 20:00), и любая своя формула
 * разъедется с файлом. Сравниваем только строки round_id из самого файла.
 */

import { CONFIG } from "./Config.js";

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
export function poolRunsAt(pool, deadlineTs) {
    const isWeeklyDay = new Date(deadlineTs).getUTCDay() === CONFIG.WEEKLY_WEEKDAY_UTC;
    if (pool === CONFIG.WEEKLY) return isWeeklyDay;
    return CONFIG.DAILY_SKIPS_WEEKLY_DAY ? !isWeeklyDay : true;
}

/** Ближайший будущий дедлайн пула (мс) */
export function nextDeadline(pool, now = Date.now()) {
    for (let i = 0; i <= 8; i++) {
        const ts = deadlineOfDay(now + i * DAY);
        if (ts > now && poolRunsAt(pool, ts)) return ts;
    }
    return null;
}

/** Последний прошедший дедлайн пула (мс) */
export function prevDeadline(pool, now = Date.now()) {
    for (let i = 0; i <= 8; i++) {
        const ts = deadlineOfDay(now - i * DAY);
        if (ts <= now && poolRunsAt(pool, ts)) return ts;
    }
    return null;
}

/** Мы в "горячем" окне вокруг розыгрыша? */
export function inActiveWindow(pool, now = Date.now()) {
    const next = nextDeadline(pool, now);
    const prev = prevDeadline(pool, now);
    if (next !== null && next - now <= CONFIG.ACTIVE_BEFORE_MS) return true;
    if (prev !== null && now - prev <= CONFIG.ACTIVE_AFTER_MS) return true;
    return false;
}

/** Мс до следующего дедлайна (для обратного отсчёта) */
export function msToNextDeadline(pool, now = Date.now()) {
    const next = nextDeadline(pool, now);
    return next === null ? null : next - now;
}

/** "05:12:44" из миллисекунд — для UI, чтобы не считать в трёх местах */
export function formatCountdown(ms) {
    if (ms === null || ms < 0) ms = 0;
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}
