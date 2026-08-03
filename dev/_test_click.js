// Клик по сектору: попадание и содержимое окна
import { createCanvas } from "@napi-rs/canvas";
globalThis.performance = { now: () => Date.now() };
const canvas = createCanvas(600,600);
canvas.getBoundingClientRect = () => ({ left:0, top:0, width:600, height:600 });
const listeners = {};
canvas.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
canvas.style = {};
let appended = null;
globalThis.window = { devicePixelRatio:1, innerWidth:1200, matchMedia:()=>({matches:false}),
  localStorage:{getItem:()=>null,setItem:()=>{}}, addEventListener(){}, removeEventListener(){} };
Object.defineProperty(globalThis,"navigator",{value:{hardwareConcurrency:8},configurable:true});
globalThis.document = { hidden:false, readyState:"complete",
  getElementById:(id)=> id==="wheel-canvas" ? canvas : null,
  createElement:()=>({ set innerHTML(v){ this._h=v; }, get innerHTML(){return this._h;},
                       classList:{add(){},remove(){}}, addEventListener(){}, remove(){},
                       id:"" }),
  body:{ appendChild:(el)=>{ appended = el; }, classList:{toggle(){}} },
  addEventListener(){}, removeEventListener(){} };
globalThis.location = { search:"" };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (fn) => 0; globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = async () => ({ ok:false, status:404, text:async()=>"{}" });

await import("../assets/js/oracle-draw.bundle.js");
const V = globalThis.window.oracleDrawV2;
globalThis.window.OracleDrawUI = {
  pool: () => "daily",
  participants: () => [["terra1aaaaaaaaaaaaaaaa",1,201,"common"],
                       ["terra1aaaaaaaaaaaaaaaa",10,203,"legendary"],
                       ["terra1bbbbbbbbbbbbbbbb",5,206,"rare"]],
  walletNfts: (a) => a === "terra1aaaaaaaaaaaaaaaa"
      ? [{tokenId:203,tier:"legendary",entries:10},{tokenId:201,tier:"common",entries:1}]
      : [{tokenId:206,tier:"rare",entries:5}],
  msg(){}, card(){}, entriesOpen(){}, fmt:v=>v, fmtShort:()=>"", wakeOracleEye(){}
};
V.refreshLive();
const r = V.bridge.ensure("daily");
r.setAngle(0);

let fails=0; const ok=(c,m)=>{ if(!c){console.log("❌",m);fails++;} else console.log("✓",m); };
ok(r.model.sectorCount === 2, "два кошелька = два сектора");

// точка в середине первого сектора
const s0 = r.model.sectors[0];
const mid = (s0.startAngle + s0.endAngle)/2;
const rad = 600/2 * 0.55;
const hit = r.sectorAt(300 + Math.cos(mid)*rad, 300 + Math.sin(mid)*rad);
ok(hit && hit.address === s0.address, "попадание в сектор по координатам");

ok(r.sectorAt(300, 300) === null, "клик в ядро не считается");
ok(r.sectorAt(300, 6) === null, "клик в обод не считается");
ok(r.sectorAt(5, 5) === null, "клик мимо колеса не считается");

// окно строится и содержит нужное
V.bridge.details.open(hit, r.theme, globalThis.window.OracleDrawUI, r.model.total);
const html = appended && appended.innerHTML || "";
ok(html.includes("#203") && html.includes("#201"), "в окне оба NFT кошелька");
ok(html.includes("LEGENDARY") && html.includes("COMMON"), "тиры подписаны");
ok(html.includes("10 entries") && html.includes("1 entry"), "entries у каждого NFT");
ok(html.includes("68.8%") || /\d+\.\d%/.test(html), "показана доля шанса");
console.log(fails?`\n${fails} ПРОВАЛОВ`:"\n✅ клик по сектору работает");
