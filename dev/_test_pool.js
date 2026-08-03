// Переключение пула на странице должно двигать и движок
import { createCanvas } from "@napi-rs/canvas";
globalThis.performance = { now: () => Date.now() };
const canvas = createCanvas(400,400);
canvas.getBoundingClientRect = () => ({left:0,top:0,width:400,height:400});
canvas.addEventListener = () => {}; canvas.style = {};
globalThis.window = { devicePixelRatio:1, innerWidth:1200, matchMedia:()=>({matches:false}),
  localStorage:{getItem:()=>null,setItem:()=>{}}, addEventListener(){}, removeEventListener(){} };
Object.defineProperty(globalThis,"navigator",{value:{hardwareConcurrency:8},configurable:true});
globalThis.document = { hidden:false, readyState:"complete",
  getElementById:(id)=> id==="wheel-canvas" ? canvas : null,
  addEventListener(){}, removeEventListener(){}, body:{classList:{toggle(){}}} };
globalThis.location = { search:"" };
globalThis.addEventListener=()=>{}; globalThis.removeEventListener=()=>{};
globalThis.requestAnimationFrame=()=>0; globalThis.cancelAnimationFrame=()=>{};
globalThis.fetch = async () => ({ ok:false, status:404, text:async()=>"{}" });

await import("../assets/js/oracle-draw.bundle.js");
const V = globalThis.window.oracleDrawV2;
let page = "daily";
globalThis.window.OracleDrawUI = {
  pool: () => page,
  participants: () => [["terra1aaaa",3,"c-1","common"]],
  msg(){}, card(){}, entriesOpen(){}, fmt:v=>v, fmtShort:()=>"", wakeOracleEye(){}
};

let fails=0; const ok=(c,m)=>{ if(!c){console.log("❌",m);fails++;} else console.log("✓",m); };

V.refreshLive();
ok(V.engine.pool === "daily", "старт на daily");

page = "weekly";
V.refreshLive();
await new Promise(r => setTimeout(r, 30));
ok(V.engine.pool === "weekly", "страница ушла на weekly → движок тоже");

// отсчёт считается для того же пула, что показан
const now = 1785774195761;                       // понедельник 16:23 UTC
const { nextDeadline } = await import("../assets/js/draw-v2/DrawClock.js");
const wk = nextDeadline("weekly", now), dl = nextDeadline("daily", now);
ok(new Date(wk).toISOString() === "2026-08-03T20:00:00.000Z", "weekly в понедельник — сегодня 20:00");
ok(new Date(dl).toISOString() === "2026-08-04T20:00:00.000Z", "daily в понедельник — завтра (сегодня weekly)");

page = "daily";
V.refreshLive();
await new Promise(r => setTimeout(r, 30));
ok(V.engine.pool === "daily", "обратно на daily");
console.log(fails?`\n${fails} ПРОВАЛОВ`:"\n✅ пул синхронизирован");
