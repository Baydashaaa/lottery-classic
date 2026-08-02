// Прогон производителя: снимок пишется и сходится сам с собой
const fs = require("fs"), path = require("path");
process.chdir(require("os").tmpdir()); fs.rmSync("/tmp/rounds", {recursive:true, force:true});
const { writeRoundSnapshot, packTickets } = require("../round-snapshot.js");

// как buildTickets: адрес повторён count раз, по одному разу на кошелёк
const participants = { A:3, B:1, C:5, D:2 };
const tickets = [];
for (const [a,n] of Object.entries(participants)) for (let i=0;i<n;i++) tickets.push(a);

const f = writeRoundSnapshot({ roundId:"daily_2026-08-01", pool:"daily", tickets,
                               blockHash:"AB12", blockHeight:99, winnerIndex:6 });
const snap = JSON.parse(fs.readFileSync(f,"utf8"));
let fails=0; const ok=(c,m)=>{ if(!c){console.log("❌",m);fails++;} else console.log("✓",m); };

ok(path.basename(f) === "daily_2026-08-01.json", "имя файла = round_id");
ok(snap.total === 11 && tickets.length === 11, "total совпал с массивом");
ok(snap.wallets === 4, "кошельков 4");
ok(JSON.stringify(snap.tickets) === JSON.stringify([["A",3],["B",1],["C",5],["D",2]]), "упаковка верна");

// разворот должен дать исходный массив
const flat=[]; for (const [a,n] of snap.tickets) for(let i=0;i<n;i++) flat.push(a);
ok(flat.join()===tickets.join(), "разворот воспроизводит исходный порядок");
ok(flat[snap.winner_index] === tickets[6], "tickets[winner_index] сходится");

// weekly: массив индексов
const f2 = writeRoundSnapshot({ roundId:"weekly_2026-07-27", pool:"weekly", tickets,
                                blockHash:"CD", blockHeight:1, winnerIndex:[6,0,9] });
const s2 = JSON.parse(fs.readFileSync(f2,"utf8"));
ok(Array.isArray(s2.winner_index) && s2.winner_index.length===3, "weekly: три индекса в снимке");

// пустой раунд не пишется
ok(writeRoundSnapshot({roundId:"x_1", pool:"daily", tickets:[]}) === null, "пустой раунд пропущен");
console.log(fails?`\n${fails} ПРОВАЛОВ`:"\n✅ производитель в порядке");
