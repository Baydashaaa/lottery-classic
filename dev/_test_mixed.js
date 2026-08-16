import { createCanvas } from "@napi-rs/canvas";
import fs from "fs";
globalThis.performance = { now: () => Date.now() };
globalThis.window = { devicePixelRatio:1, innerWidth:1400, matchMedia:()=>({matches:false}) };
Object.defineProperty(globalThis,"navigator",{value:{hardwareConcurrency:8},configurable:true});
globalThis.requestAnimationFrame=()=>0; globalThis.cancelAnimationFrame=()=>{};
const { default: TicketModel } = await import("../assets/js/wheel/TicketModel.js");
const { default: WheelRenderer } = await import("../assets/js/wheel/WheelRenderer.js");

// один кошелёк сминтил common + rare + legendary, второй только commons
const rows = [
  ["terra1mixed0000aaaa", 1,  201, "common"],
  ["terra1mixed0000aaaa", 5,  202, "rare"],
  ["terra1mixed0000aaaa", 10, 203, "legendary"],
  ["terra1plain0000bbbb", 1,  204, "common"],
  ["terra1plain0000bbbb", 1,  205, "common"],
  ["terra1rare00000cccc", 5,  206, "rare"],
];
const m = new TicketModel({tickets:rows},{maxSectors:48});
let fails=0; const ok=(c,x)=>{ if(!c){console.log("❌",x);fails++;} else console.log("✓",x); };

const mixed = m.sectors[0];
ok(m.sectorCount === 3, "три кошелька = три сектора");
ok(mixed.entries === 16, "смешанный кошелёк: 1+5+10 = 16 entries");
ok(mixed.meta.tier === "legendary", "цвет сектора - по лучшему NFT (legendary)");
ok(mixed.meta.mints === 3, "учтено, что сминчено 3 NFT");
ok(mixed.meta.tiers.legendary === 10 && mixed.meta.tiers.rare === 5 && mixed.meta.tiers.common === 1,
   "состав сохранён: 10 legendary / 5 rare / 1 common");
ok(mixed.meta.tokenId === 203, "номер токена - от лучшего NFT");
ok(m.sectors[1].meta.mints === 2 && m.sectors[1].meta.tier === "common", "второй кошелёк: 2 common");
// доля площади = доля entries
ok(Math.abs(mixed.share - 16/23) < 1e-12, "площадь = 16 из 23 entries (69.6%)");
// индексы не разъехались
ok(m.addressForIndex(0)==="terra1mixed0000aaaa" && m.addressForIndex(15)==="terra1mixed0000aaaa"
   && m.addressForIndex(16)==="terra1plain0000bbbb", "плоские индексы на месте");

const size=620, c=createCanvas(size,size);
c.getBoundingClientRect=()=>({width:size,height:size});
const r=new WheelRenderer(c,{pool:"daily",quality:"high"});
r.setPool("daily").setModel(m);
r.idle(); for(let i=0;i<60;i++) r.frame(1/60);
fs.writeFileSync("mixed-wallet.png", c.toBuffer("image/png"));
console.log(fails?`\n${fails} ПРОВАЛОВ`:"\n✅ смешанный кошелёк обрабатывается верно → mixed-wallet.png");
