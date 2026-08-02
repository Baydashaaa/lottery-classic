import fs from "fs";

const ORDER = ["WheelTheme.js","WheelGlow.js","WheelParticles.js","WheelSector.js",
               "WheelPointer.js","WheelCenter.js","WheelAnimation.js","TicketModel.js",
               "WheelRenderer.js"];

let seenTAU = false;
const parts = ORDER.map(f => {
  let s = fs.readFileSync("../assets/js/wheel/" + f, "utf8");
  s = s.split("\n").filter(l => !/^\s*import\s/.test(l) && !/^\s*export\s*\{/.test(l)).join("\n");
  s = s.replace(/^export default class/gm, "class")
       .replace(/^export default function/gm, "function")
       .replace(/^export default \{[\s\S]*?\};\s*$/gm, "")
       .replace(/^export (const|let|function|class)/gm, "$1");
  // TAU объявлен в каждом модуле одинаково — оставляем первый
  s = s.replace(/^const TAU = Math\.PI \* 2;$/gm, () => {
    if (seenTAU) return "";
    seenTAU = true; return "const TAU = Math.PI * 2;";
  });
  let extra = "";
  if (f === "WheelGlow.js") {
    // WheelRenderer обращается к модулю как Glow.*, в плоской сборке
    // пространство имён собираем руками
    extra = "\nconst Glow = { brushedRing, ringReflections, ringPulse, cosmicBackdrop, facePlate, bloom };\n";
  }
  return `/* ── ${f} ─────────────────────────────────────────── */\n${s}${extra}`;
});

const shell = fs.readFileSync("_page_shell.html", "utf8");
const boot  = fs.readFileSync("_boot.js", "utf8");
const out = shell.replace("/*__MODULES__*/", parts.join("\n\n"))
                 .replace("/*__BOOT__*/", boot);
fs.writeFileSync("oracle-draw-preview.html", out);
console.log("собрано:", (out.length/1024).toFixed(0), "КБ");
