import TicketModel from "../assets/js/wheel/TicketModel.js";
const TAU = Math.PI*2;
let fails = 0;
const ok = (c, m) => { if(!c){ console.log("❌", m); fails++; } else console.log("✓", m); };

// 1. базовый: 3 кошелька, веса 10/5/1
const m = new TicketModel({ tickets: [["A",10],["B",5],["C",1]] });
ok(m.total === 16, "total = 16");
ok(m.sectorCount === 3, "3 сектора");
ok(Math.abs(m.sectors[0].share - 10/16) < 1e-12, "площадь A = доля билетов");
ok(m.addressForIndex(0)==="A" && m.addressForIndex(9)==="A" && m.addressForIndex(10)==="B" && m.addressForIndex(15)==="C", "index → address");
ok(m.sectorForIndex(12).address === "B", "index → sector O(1)");
ok(m.verify(15,"C") && !m.verify(15,"B"), "verify ловит расхождение");

// 2. углы: покрытие полного круга без дыр
const cover = m.sectors.reduce((s,x)=>s+x.span,0);
ok(Math.abs(cover - TAU) < 1e-9, "сектора покрывают 2π ровно");
let contiguous = true;
for (let i=1;i<m.sectors.length;i++) if (Math.abs(m.sectors[i].startAngle - m.sectors[i-1].endAngle)>1e-12) contiguous=false;
ok(contiguous, "сектора стыкуются без зазоров");

// 3. угол конкретного билета лежит внутри своего сектора
let inside = true;
for (let i=0;i<m.total;i++){
  const a = m.angleForIndex(i), s = m.sectorForIndex(i);
  if (!(a >= s.startAngle - 1e-12 && a <= s.endAngle + 1e-12)) inside = false;
}
ok(inside, "angleForIndex всегда внутри своего сектора");

// 4. один кошелёк двумя минтами -> один сектор, порядок сохранён
const m2 = new TicketModel({ tickets: [["A",1],["B",1],["A",1]] });
ok(m2.sectorCount === 2, "повторный минт того же кошелька не создаёт второй сектор");
ok(m2.sectors[0].entries === 2 && m2.sectors[0].address === "A", "веса слиты");
ok(m2.addressForIndex(0)==="A" && m2.addressForIndex(1)==="B" && m2.addressForIndex(2)==="A", "плоский индекс не сдвинулся при слиянии");
ok(m2.sectorForIndex(2).address === "A", "индекс из второго минта попадает в тот же сектор");

// 5. масштаб: 400 билетов, 30 кошельков
const many = Array.from({length:30},(_,i)=>["w"+i, i%3===0?10:i%3===1?5:1]);
const m3 = new TicketModel({ tickets: many });
ok(m3.sectorCount === 30, "400 NFT от 30 кошельков = 30 секторов, не 400");
console.log("   total билетов:", m3.total, "| самый тонкий сектор:", (Math.min(...m3.sectors.map(s=>s.span))*180/Math.PI).toFixed(2), "°");

// 6. хвостовая группа
const crowd = Array.from({length:200},(_,i)=>["w"+i, i<5 ? 10 : 1]);
const m4 = new TicketModel({ tickets: crowd }, { maxSectors: 20 });
ok(m4.sectorCount === 20, "200 кошельков сжаты до 20 секторов");
ok(m4.hasGroup, "есть групповой сектор");
const g = m4.sectors.find(s=>s.isGroup);
ok(Math.abs(m4.sectors.reduce((s,x)=>s+x.span,0) - TAU) < 1e-9, "с группой круг всё ещё полный");
ok(g.entries === m4.total - m4.sectors.filter(s=>!s.isGroup).reduce((s,x)=>s+x.entries,0), "вес группы = сумма хвоста");
// победитель внутри группы находится
const gi = g.indices[3];
ok(m4.sectorForIndex(gi).isGroup, "индекс из хвоста ведёт в групповой сектор");
const sub = m4.expand(g);
ok(sub && sub.total === g.entries, "expand даёт подмодель на вес группы");
ok(sub.sectorForIndex(m4.localIndex(g, gi)) !== null, "локальный индекс работает в подмодели");
ok(Math.abs(sub.sectors[0].startAngle - g.startAngle) < 1e-12, "подмодель начинается там же, где групповой сектор");

// 7. плоский массив адресов тоже принимается
const m5 = new TicketModel({ tickets: ["A","A","B"] });
ok(m5.total===3 && m5.sectorCount===2, "плоский массив адресов нормализуется");

// 8. пустой снимок не роняет
const m6 = new TicketModel({ tickets: [] });
ok(m6.total===0 && m6.sectorCount===0 && m6.sectorForIndex(0)===null, "пустой снимок безопасен");

console.log(fails ? `\n${fails} ПРОВАЛОВ` : "\n✅ все проверки пройдены");
