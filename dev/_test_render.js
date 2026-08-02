// Headless-прогон рендерера: кадры не падают, посадка реальная
import { createCanvas } from "@napi-rs/canvas";
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.window = { devicePixelRatio: 1, innerWidth: 1200, matchMedia: () => ({matches:false}) };
Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 8 }, configurable: true });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { default: TicketModel } = await import("../assets/js/wheel/TicketModel.js");
const { default: WheelRenderer, POINTER_ANGLE, TAU } = await import("../assets/js/wheel/WheelRenderer.js");
let fails=0; const ok=(c,m)=>{if(!c){console.log("❌",m);fails++;}else console.log("✓",m);};

const rows = [["w1",12,142,"common"],["w2",5,141,"rare"],["w3",20,144,"legendary"],["w4",15,145,"rare"]];
const model = new TicketModel({tickets:rows},{maxSectors:48});
ok(model.sectors[2].meta.tier === "legendary", "тир доехал из снимка в sector.meta");
ok(model.sectors[0].meta.tokenId === 142, "tokenId доехал в sector.meta");

const canvas = createCanvas(800,800);
canvas.getBoundingClientRect = () => ({width:800,height:800});
const r = new WheelRenderer(canvas, {pool:"daily", quality:"high"});
r.setModel(model);

r.preDraw();
for (let i=0;i<180;i++) r.frame(1/60);
ok(Math.abs(r.anim.velocity) > 0.3, `PreDraw раскрутил колесо до ${Math.abs(r.anim.velocity).toFixed(2)} рад/с`);

let landed = false;
r.onLanded = () => { landed = true; };
ok(r.spinToIndex(30) === true, "spinToIndex принял индекс");
for (let i=0;i<1200 && !landed;i++) r.frame(1/60);
ok(landed, "onLanded вызван");
const under = ((POINTER_ANGLE - r.angle) % TAU + TAU) % TAU;
const want  = ((model.angleForIndex(30) % TAU) + TAU) % TAU;
ok(Math.abs(under-want) < 1e-9, "указатель встал ровно на билет #30");
ok(r.winner && r.winner.address === model.addressForIndex(30), "победитель = владелец билета #30");
ok(r.spinToIndex(9999) === false, "несуществующий индекс отклонён");

for (const q of ["high","medium","low","still"]) {
  r.setQuality(q); r.frame(1/60);
}
ok(true, "все четыре уровня качества рисуют кадр без ошибок");

r.setPool("weekly"); r.frame(1/60);
ok(r.theme.key === "weekly", "смена темы на weekly");

const empty = new WheelRenderer(canvas,{pool:"daily"});
empty.setModel(new TicketModel({tickets:[]})); empty.frame(1/60);
ok(true, "пустая модель не роняет рендер");

console.log(fails?`\n${fails} ПРОВАЛОВ`:"\n✅ рендерер в порядке");
