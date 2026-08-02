const store=new Map();
globalThis.window={localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},addEventListener(){},removeEventListener(){}};
globalThis.document={hidden:false,getElementById:()=>null,addEventListener(){},removeEventListener(){}};
globalThis.location={search:""};

const D="2026-08-04";                       // вторник
const deadline=Date.parse(D+"T20:00:00Z");
let FILE={daily:[],weekly:[]}, SNAP=null;
globalThis.fetch=async(u)=>{
  if(String(u).includes("/rounds/")) return SNAP?{ok:true,json:async()=>SNAP}:{ok:false,status:404};
  return {ok:true,status:200,text:async()=>JSON.stringify(FILE)};
};

const {default:DrawEngine}=await import("../assets/js/draw-v2/DrawEngine.js");
const {EVENTS}=await import("../assets/js/draw-v2/DrawEvents.js");
const {PHASE,derivePhase}=await import("../assets/js/draw-v2/DrawPhase.js");
const {CONFIG}=await import("../assets/js/draw-v2/Config.js");
let fails=0; const ok=(c,m)=>{if(!c){console.log("❌",m);fails++;}else console.log("✓",m);};

// ── фазовая машина как чистая функция ──────────────────────────────────
const ctx=(offset,result=null,revealing=false)=>derivePhase({
  now:deadline+offset, deadline:offset<0?deadline:deadline+86400000,
  lastDeadline:offset>=0?deadline:deadline-86400000,
  result, revealing, cfg:CONFIG});

ok(ctx(-3600000)===PHASE.OPEN,      "за час до — OPEN");
ok(ctx(-10*60000)===PHASE.LOCKED,   "за 10 минут — LOCKED");
ok(ctx(-20000)===PHASE.PRE_DRAW,    "за 20 секунд — PRE_DRAW");
ok(ctx(+5000)===PHASE.AWAITING,     "через 5 секунд после — AWAITING");
ok(ctx(+9*60000)===PHASE.AWAITING,  "через 9 минут всё ещё AWAITING");
ok(ctx(+30*60000)===PHASE.OPEN,     "через полчаса без результата — отпустили в OPEN");
const res={drawnAt:deadline+40000,skipped:false};
ok(ctx(+60000,res)===PHASE.REVEALED,"результат пришёл — REVEALED");
ok(ctx(+60000,res,true)===PHASE.REVEALING,"во время анимации — REVEALING");
ok(ctx(+60000,{drawnAt:deadline+40000,skipped:true})===PHASE.ROLLOVER,"skipped — ROLLOVER");
const stale={drawnAt:deadline-86400000,skipped:false};
ok(ctx(+60000,stale)===PHASE.AWAITING,"вчерашний результат не закрывает сегодняшний дедлайн");

// ── движок: снимок сходится ────────────────────────────────────────────
FILE.daily=[{date:D,round_id:"daily_"+D,winner:"terra1B",prize_lunc:900000,winner_index:12,entries:16,block_hash:"AB",block_height:9}];
SNAP={total:16,tickets:[["terra1A",10],["terra1B",5],["terra1C",1]]};
const e=new DrawEngine("daily"); const log=[];
e.on("*",({event})=>{if(event!==EVENTS.TICK)log.push(event);});
await e.update();
ok(e.state.verified===true,"winner_index сошёлся с адресом → verified");
ok(e.model.sectorCount===3,"модель построена: 3 сектора на 16 билетов");
ok(e.model.sectorForIndex(12).address==="terra1B","сектор победителя найден по индексу");
ok(e.replay()===true,"replay доступен");

// ── снимок от другого раунда ловится ───────────────────────────────────
FILE.daily=[{date:"2026-08-05",round_id:"daily_2026-08-05",winner:"terra1C",prize_lunc:1,winner_index:0,entries:16,block_hash:"CD",block_height:10}];
const e2=new DrawEngine("daily"); const log2=[];
e2.on("*",({event})=>{if(event!==EVENTS.TICK)log2.push(event);});
await e2.update();
ok(e2.state.verified===false,"tickets[0]=terra1A ≠ winner terra1C → verified=false");
ok(!log2.includes("DRAW_FINISHED"),"при расхождении колесо не крутится");
ok(e2.replay()===false,"replay заблокирован");

// ── без снимка: legacy-режим ───────────────────────────────────────────
SNAP=null;
FILE.daily=[{date:"2026-08-06",round_id:"daily_2026-08-06",winner:"terra1A",prize_lunc:1,winner_index:0,entries:16,block_hash:"EF",block_height:11}];
const e3=new DrawEngine("daily"); await e3.update();
ok(e3.model===null&&e3.state.verified===false,"нет снимка → модели нет, V2 канвасом не владеет");

console.log(fails?`\n${fails} ПРОВАЛОВ`:"\n✅ фазы и верификация в порядке");
