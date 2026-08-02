// Проверка: карточка появляется, даже если DATA_UPDATED пришёл раньше данных
import { createCanvas } from "@napi-rs/canvas";
globalThis.performance = { now: () => Date.now() };
const canvas = createCanvas(400,400);
canvas.getBoundingClientRect = () => ({width:400,height:400});
let cardCalls = 0, cardEl = { style:{ display:"none" }, classList:{ remove(){}, add(){} } };
globalThis.window = { devicePixelRatio:1, innerWidth:1200, matchMedia:()=>({matches:false}),
  localStorage:{getItem:()=>null,setItem:()=>{}}, addEventListener(){}, removeEventListener(){} };
Object.defineProperty(globalThis,"navigator",{value:{hardwareConcurrency:8},configurable:true});
globalThis.document = { hidden:false, readyState:"complete",
  getElementById:(id)=> id==="wheel-canvas" ? canvas : (id==="wheel-winner-card" ? cardEl : null),
  addEventListener(){}, removeEventListener(){}, body:{classList:{toggle(){}}} };
globalThis.location = { search:"" };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = async () => ({ ok:false, status:404, text:async()=>"{}" });

await import("../assets/js/oracle-draw.bundle.js");
const V = globalThis.window.oracleDrawV2;
globalThis.window.OracleDrawUI = {
  participants: () => [], pool: () => "daily",
  msg(){}, entriesOpen(){}, fmt:v=>v, fmtShort:()=>"", wakeOracleEye(){},
  card(d){ cardCalls++; cardEl.style.display = "block"; }
};

let fails=0; const ok=(c,m)=>{ if(!c){console.log("❌",m);fails++;} else console.log("✓",m); };

// движок «уже загрузил» раунд с победителем
V.engine.state.round = { key:"daily_2026-08-01", skipped:false, pool:"daily",
  winners:[{place:1,address:"terra1abc",prize:216200,tx:"TX"}] };

ok(cardCalls === 0, "до тика карточку не трогаем");
V.bridge.ensureCard();
ok(cardCalls === 1, "первый тик показал карточку");
V.bridge.ensureCard(); V.bridge.ensureCard();
ok(cardCalls === 1, "пока карточка на месте — повторно не рисуем");

cardEl.style.display = "none";           // switchLottery спрятал
V.bridge.ensureCard();
ok(cardCalls === 2, "после скрытия карточка вернулась");

V.engine.state.revealing = true; cardEl.style.display = "none";
V.bridge.ensureCard();
ok(cardCalls === 2, "во время вращения карточку не возвращаем");
V.engine.state.revealing = false;

V.engine.state.round = { skipped:true, winners:[] }; cardEl.style.display="none";
V.bridge.ensureCard();
ok(cardCalls === 2, "пропущенный раунд карточку не показывает");

console.log(fails ? `\n${fails} ПРОВАЛОВ` : "\n✅ карточка ведёт себя правильно");
