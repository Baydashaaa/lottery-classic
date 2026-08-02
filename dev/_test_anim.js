import WheelAnimation, { MOTION, rpm, TAU } from "../assets/js/wheel/WheelAnimation.js";
let fails = 0;
const ok = (c,m)=>{ if(!c){console.log("❌",m);fails++;} else console.log("✓",m); };

function run(anim, target, pointer, maxMs = 30000) {
  let t = 0;
  anim.spinTo(t, target, pointer);
  const samples = [];
  while (t < maxMs) {
    t += 1000/60;
    const s = anim.step(t);
    samples.push({ t, ...s });
    if (s.mode === MOTION.WINNER) break;
  }
  return samples;
}

// 1. посадка точная — из состояния покоя
{
  const a = new WheelAnimation();
  const target = 1.234, pointer = -Math.PI/2;
  const s = run(a, target, pointer);
  const under = ((pointer - a.angle) % TAU + TAU) % TAU;
  const want = ((target % TAU) + TAU) % TAU;
  const errDeg = Math.abs(under - want) * 180/Math.PI;
  ok(errDeg < 1e-9, `посадка из покоя: ошибка ${errDeg.toExponential(1)}°`);
  ok(s.length*1000/60 > 5000, `длительность ${(s.length/60).toFixed(1)} с`);
}

// 2. посадка точная — стартуя из уже вращающегося колеса (PreDraw)
{
  const a = new WheelAnimation();
  a.predraw(0);
  for (let t=0;t<6000;t+=1000/60) a.step(t);   // раскрутили вхолостую 6 секунд
  const v0 = a.velocity;
  ok(Math.abs(v0) > 0.5, `после PreDraw скорость ${Math.abs(v0).toFixed(2)} рад/с`);
  const target = 4.71, pointer = -Math.PI/2;
  a.spinTo(6000, target, pointer);
  let t = 6000; while (a.mode !== MOTION.WINNER && t < 40000) { t += 1000/60; a.step(t); }
  const under = ((pointer - a.angle) % TAU + TAU) % TAU;
  const want = ((target % TAU) + TAU) % TAU;
  ok(Math.abs(under-want)*180/Math.PI < 1e-9, "посадка из вращения точная");
}

// 3. скорость непрерывна: без скачков между фазами
{
  const a = new WheelAnimation();
  const s = run(a, 2.0, -Math.PI/2);
  let maxJump = 0, jumpAt = "";
  for (let i=1;i<s.length;i++){
    if (s[i].mode===MOTION.LOCK||s[i].mode===MOTION.WINNER) break;
    const d = Math.abs(s[i].velocity - s[i-1].velocity);
    if (d > maxJump) { maxJump = d; jumpAt = s[i-1].mode+"→"+s[i].mode; }
  }
  ok(maxJump < 0.9, `макс. скачок скорости за кадр ${maxJump.toFixed(3)} рад/с (${jumpAt})`);
}

// 4. угол монотонен — колесо не дёргается назад до LOCK
{
  const a = new WheelAnimation();
  const s = run(a, 0.7, -Math.PI/2);
  let mono = true;
  for (let i=1;i<s.length;i++){
    if (s[i].mode===MOTION.LOCK||s[i].mode===MOTION.WINNER) break;
    if (s[i].angle > s[i-1].angle + 1e-9) mono = false;
  }
  ok(mono, "до защёлки угол только убывает");
}

// 5. откат при LOCK есть и он в пределах 2-3°
{
  const a = new WheelAnimation();
  const s = run(a, 3.3, -Math.PI/2);
  const lock = s.filter(x=>x.mode===MOTION.LOCK);
  const land = a.plan.land;
  const maxKick = Math.max(...lock.map(x=>Math.abs(x.angle-land)))*180/Math.PI;
  ok(lock.length>0, "фаза LOCK присутствует");
  ok(maxKick > 1.5 && maxKick < 3.2, `откат ${maxKick.toFixed(2)}° (ждём ~2.6°)`);
}

// 6. число оборотов не разлетается при любом стартовом угле
{
  let bad = 0;
  for (let i=0;i<40;i++){
    const a = new WheelAnimation();
    a.angle = (Math.random()-0.5)*4000;
    a.spinTo(0, Math.random()*TAU, -Math.PI/2);
    const turns = a.plan.D / TAU;
    if (turns < 5 || turns >= 7) bad++;
  }
  ok(bad===0, "40 случайных стартов: путь всегда 5..7 оборотов");
}

// 7. intensity растёт к концу — кристалл разгорается
{
  const a = new WheelAnimation();
  const s = run(a, 1.0, -Math.PI/2);
  const mid = s[Math.floor(s.length*0.4)], late = s[Math.floor(s.length*0.92)];
  const am = new WheelAnimation(); am.velocity = mid.velocity; am.mode = MOTION.CRUISE;
  const al = new WheelAnimation(); al.velocity = late.velocity; al.mode = MOTION.DECEL;
  ok(al.intensity > am.intensity, `яркость кристалла ${am.intensity.toFixed(2)} → ${al.intensity.toFixed(2)}`);
}

// 8. prefers-reduced-motion — мгновенная посадка без вращения
{
  const a = new WheelAnimation(); a.reducedMotion = true;
  let settled = false;
  a.spinTo(0, 2.5, -Math.PI/2, ()=>{settled=true;});
  const under = ((-Math.PI/2 - a.angle) % TAU + TAU) % TAU;
  ok(settled && Math.abs(under - 2.5) < 1e-9, "reduced-motion: сразу на месте, колбэк вызван");
}

console.log(fails ? `\n${fails} ПРОВАЛОВ` : "\n✅ физика в порядке");
