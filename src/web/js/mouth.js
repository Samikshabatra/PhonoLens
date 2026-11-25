/* PhonoLens mouth-position diagrams.
   A side view of the mouth (facing left): lips, teeth, palate, tongue, airflow and voicing,
   generated from a few articulatory settings per sound. Exposes window.PLMouth. */
(() => {
"use strict";

// lips: spread | neutral | rounded | closed | lipteeth
// tip:  down | ridge | near | between | post | curl
// body: [x, y] of the tongue hump (front x≈88 … back x≈150; high y≈48 … low y≈82)
// jaw:  how far the jaw opens (0–16); air: hiss | stop | smooth | nasal | open
const P = {
  i:  { lips: "spread",  tip: "down", body: [88, 49], jaw: 2,  voiced: 1, air: "open" },
  "ɪ": { lips: "spread",  tip: "down", body: [96, 56], jaw: 5,  voiced: 1, air: "open" },
  "eɪ": { lips: "spread", tip: "down", body: [93, 58], jaw: 6,  voiced: 1, air: "open" },
  "ɛ": { lips: "neutral", tip: "down", body: [97, 64], jaw: 9,  voiced: 1, air: "open" },
  "æ": { lips: "spread",  tip: "down", body: [102, 76], jaw: 15, voiced: 1, air: "open" },
  "ʌ": { lips: "neutral", tip: "down", body: [118, 70], jaw: 10, voiced: 1, air: "open" },
  "ɑ": { lips: "neutral", tip: "down", body: [140, 80], jaw: 16, voiced: 1, air: "open" },
  "ɔ": { lips: "rounded", tip: "down", body: [146, 70], jaw: 12, voiced: 1, air: "open" },
  "oʊ": { lips: "rounded", tip: "down", body: [146, 62], jaw: 8, voiced: 1, air: "open" },
  "ʊ": { lips: "rounded", tip: "down", body: [140, 57], jaw: 5,  voiced: 1, air: "open" },
  u:  { lips: "rounded", tip: "down", body: [148, 50], jaw: 3,  voiced: 1, air: "open" },
  "ɝ": { lips: "rounded", tip: "curl", body: [120, 62], jaw: 6,  voiced: 1, air: "open" },
  "aɪ": { lips: "neutral", tip: "down", body: [130, 78], jaw: 15, voiced: 1, air: "open" },
  "aʊ": { lips: "neutral", tip: "down", body: [130, 78], jaw: 15, voiced: 1, air: "open" },
  "ɔɪ": { lips: "rounded", tip: "down", body: [146, 70], jaw: 12, voiced: 1, air: "open" },
  v:  { lips: "lipteeth", tip: "down", body: [112, 72], jaw: 4, voiced: 1, air: "hiss" },
  f:  { lips: "lipteeth", tip: "down", body: [112, 72], jaw: 4, voiced: 0, air: "hiss" },
  w:  { lips: "rounded", tip: "down", body: [146, 52], jaw: 3,  voiced: 1, air: "smooth" },
  "θ": { lips: "neutral", tip: "between", body: [110, 70], jaw: 5, voiced: 0, air: "hiss" },
  "ð": { lips: "neutral", tip: "between", body: [110, 70], jaw: 5, voiced: 1, air: "hiss" },
  t:  { lips: "neutral", tip: "ridge", body: [108, 66], jaw: 3,  voiced: 0, air: "stop" },
  d:  { lips: "neutral", tip: "ridge", body: [108, 66], jaw: 3,  voiced: 1, air: "stop" },
  n:  { lips: "neutral", tip: "ridge", body: [108, 66], jaw: 3,  voiced: 1, air: "nasal" },
  l:  { lips: "neutral", tip: "ridge", body: [112, 72], jaw: 4,  voiced: 1, air: "smooth" },
  s:  { lips: "spread",  tip: "near",  body: [104, 62], jaw: 2,  voiced: 0, air: "hiss" },
  z:  { lips: "spread",  tip: "near",  body: [104, 62], jaw: 2,  voiced: 1, air: "hiss" },
  "ʃ": { lips: "rounded", tip: "post", body: [98, 54], jaw: 3,  voiced: 0, air: "hiss" },
  "ʒ": { lips: "rounded", tip: "post", body: [98, 54], jaw: 3,  voiced: 1, air: "hiss" },
  "tʃ": { lips: "rounded", tip: "post", body: [96, 52], jaw: 3, voiced: 0, air: "stop" },
  "dʒ": { lips: "rounded", tip: "post", body: [96, 52], jaw: 3, voiced: 1, air: "stop" },
  p:  { lips: "closed",  tip: "down", body: [115, 72], jaw: 1,  voiced: 0, air: "stop" },
  b:  { lips: "closed",  tip: "down", body: [115, 72], jaw: 1,  voiced: 1, air: "stop" },
  m:  { lips: "closed",  tip: "down", body: [115, 72], jaw: 1,  voiced: 1, air: "nasal" },
  k:  { lips: "neutral", tip: "down", body: [150, 45], jaw: 5,  voiced: 0, air: "stop" },
  "ɡ": { lips: "neutral", tip: "down", body: [150, 45], jaw: 5,  voiced: 1, air: "stop" },
  "ŋ": { lips: "neutral", tip: "down", body: [150, 45], jaw: 5,  voiced: 1, air: "nasal" },
  "ɹ": { lips: "rounded", tip: "curl", body: [122, 60], jaw: 5, voiced: 1, air: "smooth" },
  h:  { lips: "neutral", tip: "down", body: [118, 72], jaw: 9,  voiced: 0, air: "hiss" },
  j:  { lips: "spread",  tip: "down", body: [88, 47], jaw: 2,  voiced: 1, air: "smooth" },
};

// Plain-language cues for the sounds Indian-English learners most often work on.
const CUES = {
  v: { name: "/v/ as in very", lips: "Rest your upper teeth lightly on your lower lip. Don't round your lips.", tongue: "Relaxed and low.", voice: "Voice on: you should feel a buzz on your lip." },
  w: { name: "/w/ as in west", lips: "Round your lips into a small circle; teeth don't touch them.", tongue: "Back of the tongue raised.", voice: "Voice on, then glide straight into the vowel." },
  f: { name: "/f/ as in fan", lips: "Upper teeth on the lower lip.", tongue: "Relaxed.", voice: "Voice off: only air, like a soft hiss." },
  p: { name: "/p/ as in pen", lips: "Press both lips together, then let them pop open.", tongue: "Relaxed.", voice: "Voice off, with a small puff of air." },
  "θ": { name: "/θ/ as in thin", lips: "Relaxed and slightly open.", tongue: "Tip lightly between your teeth. Blow air over it; don't stop the air.", voice: "Voice off." },
  "ð": { name: "/ð/ as in this", lips: "Relaxed and slightly open.", tongue: "Tip lightly between your teeth, air flowing over it.", voice: "Voice on: a gentle buzz on the tongue." },
  t: { name: "/t/ as in top", lips: "Relaxed.", tongue: "Tip presses on the ridge just behind your upper teeth, then releases.", voice: "Voice off." },
  d: { name: "/d/ as in day", lips: "Relaxed.", tongue: "Tip presses on the ridge behind your upper teeth, then releases.", voice: "Voice on." },
  s: { name: "/s/ as in sun", lips: "Slightly spread.", tongue: "Tip close to the ridge behind your teeth, leaving a thin groove for air.", voice: "Voice off: a sharp hiss." },
  z: { name: "/z/ as in zoo", lips: "Slightly spread.", tongue: "Same place as /s/, close to the ridge, not touching.", voice: "Voice on: the hiss should buzz. Keep it buzzing at the end of words like 'bags'." },
  "ʃ": { name: "/ʃ/ as in she", lips: "Push your lips slightly forward and round them.", tongue: "Pull the tip a little back from the ridge; tongue body raised.", voice: "Voice off: a soft 'shh'." },
  "ʒ": { name: "/ʒ/ as in measure", lips: "Slightly forward and rounded, like 'sh'.", tongue: "Same place as 'sh'. No stop before it.", voice: "Voice on: 'sh' with a buzz." },
  "dʒ": { name: "/dʒ/ as in jam", lips: "Slightly rounded.", tongue: "Tip touches behind the ridge, then releases into a buzzing 'zh'.", voice: "Voice on." },
  l: { name: "/l/ as in sell", lips: "Relaxed.", tongue: "Tip touches the ridge behind your teeth; air flows around the sides. Hold it, even before /z/ or /t/.", voice: "Voice on." },
  "ɹ": { name: "/r/ as in red", lips: "Slightly rounded.", tongue: "Tip curls up and back without touching the roof of your mouth.", voice: "Voice on: a smooth sound, not a tap." },
  "æ": { name: "/æ/ as in cat", lips: "Spread.", tongue: "Low and to the front. Open your jaw wider than for 'bed'.", voice: "Voice on." },
  "ɛ": { name: "/ɛ/ as in bed", lips: "Relaxed.", tongue: "Front, halfway down. Jaw less open than for 'cat'.", voice: "Voice on." },
  i: { name: "/i/ as in sheep", lips: "Spread, like a smile.", tongue: "High and to the front. Hold it a little longer.", voice: "Voice on." },
  "ɪ": { name: "/ɪ/ as in ship", lips: "Relaxed.", tongue: "High-front but more relaxed than 'sheep'. Keep it short.", voice: "Voice on." },
  u: { name: "/u/ as in food", lips: "Rounded and pushed forward.", tongue: "High at the back. Hold it longer.", voice: "Voice on." },
  "ʊ": { name: "/ʊ/ as in book", lips: "Loosely rounded.", tongue: "High-back but relaxed. Keep it short.", voice: "Voice on." },
  "ʌ": { name: "/ʌ/ as in cup", lips: "Relaxed.", tongue: "Central and low-mid. Short and quick.", voice: "Voice on." },
  "ɑ": { name: "/ɑ/ as in father", lips: "Relaxed and open.", tongue: "Low and back. Open your jaw wide.", voice: "Voice on." },
  "ɔ": { name: "/ɔ/ as in thought", lips: "Rounded.", tongue: "Low-mid at the back.", voice: "Voice on." },
  "ɝ": { name: "/ɝ/ as in bird", lips: "Slightly rounded.", tongue: "Bunched in the middle with the tip curled back a little.", voice: "Voice on." },
};

const LIPS_TXT = { spread: "Spread lips.", neutral: "Relaxed lips.", rounded: "Rounded lips.", closed: "Lips closed, then released.", lipteeth: "Upper teeth on the lower lip." };
const TIP_TXT = { down: "Tongue tip resting behind the lower teeth.", ridge: "Tongue tip on the ridge behind the upper teeth.", near: "Tongue tip close to the ridge behind the upper teeth.", between: "Tongue tip between the teeth.", post: "Tongue tip just behind the ridge, body raised.", curl: "Tongue tip curled up and back." };

function cues(ph) {
  if (CUES[ph]) return CUES[ph];
  const p = P[ph]; if (!p) return null;
  return { name: `/${ph}/`, lips: LIPS_TXT[p.lips], tongue: TIP_TXT[p.tip], voice: p.voiced ? "Voice on." : "Voice off." };
}

/* ---------- drawing ---------- */
function svg(ph, opts = {}) {
  const p = P[ph]; if (!p) return "";
  const j = p.jaw, tone = opts.tone || "target";
  const ink = "var(--muted)";
  const tongueFill = tone === "target" ? "var(--m-tongue)" : "var(--m-tongue2)";

  // lips
  let ul, ll;  // [x, y] end points; lips are thick round strokes starting near the teeth
  switch (p.lips) {
    case "spread":  ul = [27, 60]; ll = [27, 84 + j]; break;
    case "rounded": ul = [13, 64]; ll = [13, 78 + j * 0.5]; break;
    case "closed":  ul = [19, 70]; ll = [19, 76]; break;
    case "lipteeth": ul = [20, 57]; ll = [37, 75]; break;
    default:        ul = [21, 58]; ll = [21, 86 + j];
  }
  const llRoot = p.lips === "lipteeth" ? [46, 88] : [42, 88 + j];

  // tongue tip
  const tips = { down: [49, 95 + j], ridge: [55, 57], near: [55, 61], between: [27, 71], post: [66, 59], curl: [72, 61] };
  const [tx, ty] = tips[p.tip];
  const [hx, hy0] = p.body, hy = hy0 + (p.tip === "down" ? j * 0.25 : 0);
  const floor = 132 + j * 0.4;
  const tongue = p.tip === "curl"
    ? `M54 ${floor} C50 ${floor - 22}, ${tx - 16} ${ty + 22}, ${tx - 8} ${ty + 8} C${tx - 4} ${ty - 2}, ${tx + 4} ${ty - 6}, ${tx + 6} ${ty + 2} C${tx + 10} ${ty + 12}, ${hx - 24} ${hy}, ${hx} ${hy} C${hx + 26} ${hy + 4}, 168 ${Math.max(hy + 22, 98)}, 174 126 L176 140 L54 140 Z`
    : `M54 ${floor} C47 ${floor - 18}, ${tx - 8} ${ty + 12}, ${tx} ${ty} C${tx + 10} ${ty - 6}, ${hx - 30} ${hy - 2}, ${hx} ${hy} C${hx + 26} ${hy + 4}, 168 ${Math.max(hy + 22, 98)}, 174 126 L176 140 L54 140 Z`;

  // airflow: from the throat forward to the lips
  const mouthY = p.lips === "closed" ? 73 : (ul[1] + ll[1]) / 2;
  const air = p.air === "nasal"
    ? `<path d="M176 92 C176 60, 168 36, 140 26 L60 20" class="m-air" marker-end="url(#ah-${opts.id})"/>`
    : `<path d="M174 100 C160 ${Math.min(hy - 8, 80)}, 120 ${Math.min(hy - 12, 50)}, 80 ${Math.min(ty - 6, 60)} S 30 ${mouthY}, 6 ${mouthY}" class="m-air${p.air === "stop" ? " stop" : ""}" marker-end="url(#ah-${opts.id})"/>`;
  const stopMark = p.air === "stop"
    ? (p.lips === "closed" ? `<circle cx="20" cy="73" r="5" class="m-stop"/>` : p.tip === "ridge" || p.tip === "post" ? `<circle cx="${tx}" cy="${ty - 3}" r="5" class="m-stop"/>` : `<circle cx="${hx}" cy="${hy - 6}" r="5" class="m-stop"/>`)
    : "";
  const buzz = p.voiced
    ? `<path d="M188 112 l-4 4 l8 4 l-8 4 l8 4 l-4 4" class="m-buzz"/><text x="182" y="146" class="m-lab" text-anchor="middle">buzz</text>`
    : `<text x="182" y="146" class="m-lab" text-anchor="middle">no buzz</text>`;

  const tongueSvg = `<path d="${tongue}" fill="${tongueFill}" class="m-tongue"/>`;
  const teeth = `<path d="M44 55 L40 72 L47 72 L51 57 Z" class="m-teeth"/><path d="M44 ${100 + j} L42 ${84 + j} L48 ${84 + j} L51 ${100 + j} Z" class="m-teeth"/>`;
  return `<svg viewBox="0 0 200 150" class="mouth ${tone}" role="img" aria-label="Mouth position for /${ph}/">
  <defs><marker id="ah-${opts.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--m-air)"/></marker></defs>
  <path d="M42 48 C70 34, 130 28, 160 40 C176 48, 184 60, 188 80 L190 148 L40 148 Z" class="m-cavity"/>
  <path d="M48 56 C58 45, 90 38, 120 36 C142 35, 160 42, 172 54 C178 62, 180 70, 180 76" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>
  <text x="112" y="30" class="m-lab" text-anchor="middle">roof of mouth</text>
  ${p.tip === "between" ? teeth + tongueSvg : tongueSvg + teeth}
  <path d="M44 52 Q32 52 ${ul[0]} ${ul[1]}" class="m-lip"/>
  <path d="M${llRoot[0]} ${llRoot[1]} Q32 ${llRoot[1] + 2} ${ll[0]} ${ll[1]}" class="m-lip"/>
  ${air}${stopMark}${buzz}
  <text x="6" y="${p.lips === "rounded" ? 96 + j * 0.5 : 108 + j}" class="m-lab">lips</text>
  <text x="120" y="${Math.min(136, hy + 30)}" class="m-lab" text-anchor="middle">tongue</text>
</svg>`;
}

window.PLMouth = { svg, cues, has: (ph) => !!P[ph] };
})();
