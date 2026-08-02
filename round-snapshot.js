/**
 * Oracle Draw — снимок билетов раунда (сторона производителя)
 *
 * Кладётся в .github/scripts/ рядом с lottery-draw.js.
 *
 * Зачем: колесо на сайте должно быть ТЕМ ЖЕ массивом билетов, по которому
 * считался winner_index. Восстановить его после розыгрыша нельзя —
 * /round-complete проставляет consumedInRound, и /round-stats возвращает
 * уже другое. Поэтому массив замораживается в момент розыгрыша.
 *
 * Лежит в КОРНЕ репозитория, рядом с lottery-draw.js — workflow запускает
 * `node lottery-draw.js` из корня, и WINNERS_PATH там тоже path.resolve
 * от cwd.
 *
 * Файл называется по round_id: rounds/daily_2026-08-01.json. Тот же
 * round_id лежит в winners.json, поэтому клиент никогда не промахнётся
 * мимо снимка — в отличие от поля date, которое берётся в момент записи.
 *
 * При skipped-раунде снимок не пишется.
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(process.cwd(), "rounds");

/**
 * Плоский массив адресов → пары [адрес, подряд идущих билетов].
 * Повторное появление кошелька позже по списку даёт ОТДЕЛЬНУЮ пару —
 * так сохраняется исходный порядок usedAt, а значит и индексы.
 */
function packTickets(tickets, meta) {
    // meta — необязательная карта address -> {tokenId, tier}; нужна колесу,
    // чтобы показать картинку NFT и редкость. На индексы не влияет.
    const pairs = [];
    for (const address of tickets) {
        const last = pairs[pairs.length - 1];
        if (last && last[0] === address) last[1]++;
        else {
            const m = meta && meta[address];
            pairs.push(m ? [address, 1, m.tokenId ?? null, m.tier ?? null] : [address, 1]);
        }
    }
    return pairs;
}

function writeRoundSnapshot({ roundId, pool, tickets, blockHash, blockHeight, winnerIndex, meta }) {
    if (!roundId) throw new Error('round-snapshot: roundId обязателен');
    if (!Array.isArray(tickets) || tickets.length === 0) return null;

    const packed = packTickets(tickets, meta);
    const wallets = new Set(tickets).size;

    const payload = {
        _verify: [
            "Этот файл — массив билетов на момент розыгрыша, в том порядке,",
            "в котором его использовал lottery-draw.js.",
            "1. Разверни tickets: пара [addr, n] даёт n подряд идущих билетов.",
            "2. Длина должна совпасть с total и с entries в winners.json.",
            "3. winner_index — позиция в этом развёрнутом массиве.",
            "4. tickets[winner_index] должен равняться winner из winners.json.",
            "   Для weekly winner_index — массив индексов трёх мест."
        ],
        round_id: roundId,
        pool,
        total: tickets.length,
        wallets,
        tickets: packed,
        block_hash: blockHash || null,
        block_height: blockHeight ?? null,
        winner_index: winnerIndex ?? null,
        generated_at: new Date().toISOString()
    };

    // самопроверка: не выпускаем снимок, который не сходится сам с собой
    const flat = [];
    for (const [addr, n] of packed) for (let i = 0; i < n; i++) flat.push(addr);
    if (flat.length !== tickets.length) {
        throw new Error(`round-snapshot: упаковка потеряла билеты (${flat.length} vs ${tickets.length})`);
    }
    for (let i = 0; i < flat.length; i++) {
        if (flat[i] !== tickets[i]) {
            throw new Error(`round-snapshot: порядок билетов разъехался на позиции ${i}`);
        }
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${roundId}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 1));
    console.log(`[snapshot] ${file} — ${tickets.length} билетов, ${wallets} кошельков, ${packed.length} пар`);
    return file;
}

module.exports = { writeRoundSnapshot, packTickets };
