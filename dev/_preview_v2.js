import { createCanvas } from "@napi-rs/canvas";
import fs from "fs";

globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.window = { devicePixelRatio: 1, innerWidth: 1200,
  matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 8 }, configurable: true });
globalThis.Image = class { set src(v){ this._s=v; } get complete(){ return false; } };

const { default: TicketModel } = await import("../assets/js/wheel/TicketModel.js");
const { default: WheelRenderer } = await import("../assets/js/wheel/WheelRenderer.js");
const { default: WheelAnimation } = await import("../assets/js/wheel/WheelAnimation.js");

// Данные с макета пользователя
const daily = [
  ["terra18kkkskegx7", 12, 142, "common"],
  ["terra1q9a3k9d2f1", 5,  141, "common"],
  ["terra1u8d9f0zzqq", 20, 144, "legendary"],
  ["terra19aa7k2dm31", 15, 145, "rare"],
  ["terra1j6k9mpq7wz", 10, 147, "common"],
  ["terra19116f8mab2", 18, 146, "common"],
  ["terra18u5k2d99x1", 15, 145, "rare"],
  ["terra1a3d7ax0m77", 7,  148, "legendary"],
  ["terra1k72dfaa1mm", 8,  143, "rare"],
];
const crowd = Array.from({length: 90}, (_,i) =>
  ["terra1w" + String(i).padStart(4,"0") + "zzzz", i < 4 ? 25 : 1, 100+i,
   i%7===0 ? "legendary" : i%3===0 ? "rare" : "common"]);

function build(rows){ return new TicketModel({ tickets: rows }, { maxSectors: 48 }); }

function shot(name, pool, rows, tune) {
  const canvas = createCanvas(1000, 1000);
  canvas.getBoundingClientRect = () => ({ width: 1000, height: 1000 });
  const r = new WheelRenderer(canvas, { pool, quality: "high" });
  r.setPool(pool);
  r.setPool(pool).setModel(build(rows));
  const anim = new WheelAnimation();
  tune && tune(r, anim);
  r.render(2400, { intensity: anim.intensity, isSpinning: anim.isSpinning });
  fs.writeFileSync(name, canvas.toBuffer("image/png"));
  console.log("→", name, "| секторов:", r.model.sectorCount, "| билетов:", r.model.total);
}

shot("v2-daily.png",  "daily",  daily);
shot("v2-weekly.png", "weekly", daily);
shot("v2-winner.png", "daily",  daily, (r) => {
  const s = r.model.sectorForIndex(30);
  r.setWinner(s);
  r.revealProgress = 1;
  r.setAngle(-Math.PI/2 - r.model.angleForIndex(30));
});
shot("v2-crowd.png",  "daily",  crowd, (r) => { r.setAngle(0.3); });
