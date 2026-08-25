/**
 * Сборка всего фронта Draw V2 в один файл.
 *
 * Зачем: у `import "./X.js"` внутри модулей нет query-строки, поэтому
 * `index.js?v=5` НЕ сбрасывает кэш вложенных файлов - браузер продолжает
 * крутить старый WheelRenderer, пока не истечёт TTL у Pages/Cloudflare.
 * Один файл решает это насовсем: у него есть ?v= и вложенных импортов нет.
 *
 *   node dev/_build_bundle.js            # из корня репо
 */
import fs from "fs";

const WHEEL = ["WheelTheme.js","WheelGlow.js","WheelParticles.js","WheelSector.js",
               "WheelPointer.js","WheelCenter.js","WheelAnimation.js",
               "TicketModel.js","WheelRenderer.js"];
const CORE  = ["Config.js","DrawClock.js","DrawPhase.js","DrawState.js","DrawEvents.js",
               "DrawAPI.js","DrawEngine.js","DrawScheduler.js","SectorDetails.js","DrawBridge.js","index.js"];

const files = [
  // Правило построения билетов. Лежит в корне, потому что им пользуется и
  // lottery-draw.js - один экземпляр на скрипт и на браузер. Идёт первым:
  // на него ссылается DrawEngine, а ему самому ничего отсюда не нужно.
  ["chain-tickets.js", "chain-tickets.js"],
  ...WHEEL.map(f => ["assets/js/wheel/" + f, f]),
  ...CORE .map(f => ["assets/js/draw-v2/" + f, f]),
];

// ── обнаружение конфликтов имён до сборки ──────────────────────────────
const declared = new Map();
const dup = [];
for (const [path, name] of files) {
  const src = fs.readFileSync(path, "utf8");
  const re = /^(?:export\s+)?(?:default\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1];
    if (declared.has(id)) dup.push(`${id}: ${declared.get(id)} и ${name}`);
    else declared.set(id, name);
  }
}
// TAU объявлен одинаково в нескольких модулях - это ожидаемо, остальное нет
const unexpected = dup.filter(d => !d.startsWith("TAU:"));
if (unexpected.length) {
  console.error("КОНФЛИКТ ИМЁН, сборка остановлена:\n  " + unexpected.join("\n  "));
  process.exit(1);
}

let seenTAU = false;
const parts = files.map(([path, name]) => {
  let s = fs.readFileSync(path, "utf8");
  s = s.split("\n")
       .filter(l => !/^\s*import\s/.test(l) && !/^\s*export\s*\{/.test(l))
       .join("\n");
  s = s.replace(/^export default class/gm, "class")
       .replace(/^export default function/gm, "function")
       .replace(/^export default \{[\s\S]*?\};\s*$/gm, "")
       .replace(/^export (const|let|function|class)/gm, "$1")
       .replace(/^const TAU = Math\.PI \* 2;$/gm, () =>
          seenTAU ? "" : (seenTAU = true, "const TAU = Math.PI * 2;"));

  // WheelRenderer обращается к модулю свечения как Glow.*
  const extra = name === "WheelGlow.js"
    ? "\nconst Glow = { brushedRing, ringReflections, ringPulse, cosmicBackdrop, facePlate, bloom };\n"
    : "";
  return `/* ── ${name} ─────────────────────────────────── */\n${s}${extra}`;
});

const version = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const out =
`/* Oracle Draw V2 - собранный бандл. НЕ РЕДАКТИРОВАТЬ.
   Источники: assets/js/wheel/ и assets/js/draw-v2/
   Пересобрать: node dev/_build_bundle.js
   Версия сборки: ${version} */

${parts.join("\n\n")}
`;

fs.writeFileSync("assets/js/oracle-draw.bundle.js", out);
console.log(`собран assets/js/oracle-draw.bundle.js - ${(out.length/1024).toFixed(0)} КБ, версия ${version}`);
console.log(`подключение: <script type="module" src="assets/js/oracle-draw.bundle.js?v=${version}"></script>`);
