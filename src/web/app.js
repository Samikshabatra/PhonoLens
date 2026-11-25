/* PhonoLens web app: listen → record (or shadow) → analyse → improve.
   Talks to the FastAPI backend: /health /prompts /norms /pronounce /tts /analyze. */
(() => {
"use strict";
const SR = 16000;
const MAX_REC_S = 20;
const VAD = { speechMs: 200, endSilenceMs: 1500, noSpeechMs: 8000, minLevel: 0.012, ratio: 4 };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

const S = {
  audio: null, result: null, norms: {}, spec: null, pitch: null,
  sel: -1,             // selected phone index
  play: null,          // own-recording playback
  rec: null,           // recording state
  voice: "female",     // reference voice
  mode: "practice",    // practice | shadow
  drill: null,         // { set, i, scores: [] }
  refWords: [],        // [{word, phones}] for the current sentence
  shadowing: false,    // the reference is playing before an automatic recording
  cmpRun: 0,           // token to cancel a running word-by-word comparison
};

/* ================= helpers ================= */
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 3200);
}
function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const x = canvas.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { x, w: canvas.clientWidth, h: canvas.clientHeight };
}
const dur = () => (S.audio ? S.audio.length / SR : 0);
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const hexRgb = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const sentence = () => (S.drill ? S.drill.set.items[S.drill.i] : ($("#customText").value.trim() || $("#promptSel").value));
const resultIsCurrent = () => S.result && S.result.text === sentence();

/* ================= result vocabulary ================= */
function kindOf(p) {
  const st = p.status || (!p.ok ? "error" : p.accent_variant ? "variant" : "correct");
  return { error: "bad", almost: "alm", variant: "var", correct: "ok" }[st];
}
function wordKind(wi) {
  const ks = S.result.phones.filter((p) => p.word_index === wi).map(kindOf);
  return ["bad", "alm", "var"].find((k) => ks.includes(k)) || "ok";
}
const KIND_ICON = { bad: "!", alm: "~", var: "≈", ok: "✓" };
const KIND_LABEL = { bad: "Needs work", alm: "Almost", var: "Indian-English variant", ok: "Clear" };
const KIND_COLOR = { bad: "var(--bad)", alm: "var(--alm)", var: "var(--var)", ok: "var(--ok)" };

/* ================= theme + decoration ================= */
function applyTheme(t) {
  if (t === "dark") document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
  store.set("pl-theme", t); drawDecor(); redrawAll(); renderFocus();
}
$("#modeBtn").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

function drawDecor() {
  const hc = $("#heroart"); const { x, w, h } = fit(hc);
  x.clearRect(0, 0, w, h);
  const ink = css("--heroink"), acc = css("--accent"), cx = w * 0.72, cy = h * 0.5;
  const g = x.createRadialGradient(cx, cy, 10, cx, cy, 220); g.addColorStop(0, acc + "50"); g.addColorStop(1, acc + "00");
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let k = 0; k < 26; k++) {
    x.beginPath();
    for (let i = 0; i <= w; i += 4) { const u = i / w, a = Math.pow(u, 1.6); const y = cy + Math.sin(u * 8 + k * 0.21) * 46 * a + (k - 13) * 2.6 * a * Math.cos(u * 3.2); i ? x.lineTo(i, y) : x.moveTo(i, y); }
    const lg = x.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, ink + "00"); lg.addColorStop(0.6, ink + "30"); lg.addColorStop(1, ink + "5a");
    x.strokeStyle = lg; x.lineWidth = 0.7; x.stroke();
  }
  x.strokeStyle = acc;
  for (let r = 22; r < 140; r += 18) { x.globalAlpha = Math.max(0.06, 0.55 - r / 280); x.lineWidth = 1.4; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke(); }
  x.globalAlpha = 1; x.fillStyle = acc; x.beginPath(); x.arc(cx, cy, 9, 0, 7); x.fill();
  const sc = $("#sidewaves"); const s = fit(sc);
  s.x.clearRect(0, 0, s.w, s.h); s.x.strokeStyle = css("--accent2"); s.x.lineWidth = 0.7;
  for (let k = 0; k < 22; k++) {
    s.x.globalAlpha = 0.12 + k / 70; s.x.beginPath();
    for (let y = 0; y <= s.h; y += 4) { const u = y / s.h; const X = 20 + u * 90 + Math.sin(u * 6 + k * 0.25) * 40 * u + k * 2.5; y ? s.x.lineTo(X, y) : s.x.moveTo(X, y); }
    s.x.stroke();
  }
  s.x.globalAlpha = 1;
}

/* ================= boot ================= */
async function boot() {
  applyTheme(store.get("pl-theme") === "dark" ? "dark" : "light");
  const st = $("#status"), stt = $("#statusText");
  try { const h = await (await fetch("/health")).json(); st.classList.add("ready"); stt.textContent = `Model ready · ${h.device === "cuda" ? "GPU" : "CPU"}`; }
  catch (e) { st.classList.add("down"); stt.textContent = "Server not reachable"; }
  try { const p = (await (await fetch("/prompts")).json()).prompts; $("#promptSel").innerHTML = p.map((s) => `<option>${esc(s)}</option>`).join(""); }
  catch (e) { $("#promptSel").innerHTML = "<option>The thin vest was very warm.</option>"; }
  try { S.norms = (await (await fetch("/norms")).json()).vowels || {}; } catch (e) { S.norms = {}; }
  setVoice(store.get("pl-voice") === "male" ? "male" : "female");
  setMode(store.get("pl-mode") === "shadow" ? "shadow" : "practice");
  refreshRef(); renderResult(); renderHistory(); renderDrills(); redrawAll();
}

/* ================= modes + voice ================= */
function setMode(m) {
  S.mode = m; store.set("pl-mode", m);
  $$(".modes button").forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  idleMic();
}
$$(".modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
function setVoice(v) {
  S.voice = v; store.set("pl-voice", v);
  $$(".voice button").forEach((b) => { const on = b.dataset.voice === v; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
}
$$(".voice button").forEach((b) => b.addEventListener("click", () => setVoice(b.dataset.voice)));

function micState(state, label, title) {
  const m = $("#recBtn"); m.classList.remove("listening", "live", "waiting"); if (state) m.classList.add(state);
  $("#recLabel").textContent = label; $("#recTitle").textContent = title;
  m.setAttribute("aria-label", label);
}
function idleMic() {
  if (S.rec || S.shadowing) return;
  if (S.mode === "shadow") micState(null, "Listen & repeat", "The sentence plays, then it's your turn. Space works too.");
  else micState(null, S.audio ? "Record again" : "Record", "Tap the mic or press Space");
}

/* ================= recording (with automatic stop) ================= */
async function to16k(data, rate) {
  if (rate === SR) return data;
  const len = Math.max(1, Math.ceil((data.length * SR) / rate));
  const oc = new OfflineAudioContext(1, len, SR);
  const b = oc.createBuffer(1, data.length, rate); b.copyToChannel(data, 0);
  const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
  return (await oc.startRendering()).getChannelData(0).slice();
}

async function startRec() {
  if (S.rec) return;
  stopPlay(); stopRef(); S.cmpRun++;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
  catch (e) { idleMic(); toast("Microphone access was blocked. Allow the microphone for this site, or upload a recording instead.", true); return; }
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const rec = { ctx, src, proc, stream, chunks: [], levels: [], t0: performance.now(), floor: null, voicedMs: 0, silentMs: 0, speaking: false, done: null };
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0); rec.chunks.push(new Float32Array(d));
    let m = 0, ss = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); ss += v * v; if (v > m) m = v; }
    rec.levels.push(m);
    const rms = Math.sqrt(ss / d.length), ms = (d.length / ctx.sampleRate) * 1000;
    rec.floor = rec.floor == null ? rms : Math.min(rec.floor * 1.003, Math.max(rms, 1e-5));
    const loud = rms > Math.max(VAD.minLevel, rec.floor * VAD.ratio);
    if (loud) { rec.voicedMs += ms; rec.silentMs = 0; if (rec.voicedMs >= VAD.speechMs) rec.speaking = true; }
    else { rec.voicedMs = Math.max(0, rec.voicedMs - ms / 2); if (rec.speaking) rec.silentMs += ms; }
    const t = performance.now() - rec.t0;
    if (rec.speaking && rec.silentMs >= VAD.endSilenceMs) rec.done = "auto";
    else if (!rec.speaking && t >= VAD.noSpeechMs) rec.done = "nospeech";
  };
  src.connect(proc); proc.connect(ctx.destination);
  S.rec = rec;
  micState("listening", "Listening…", "Start reading. Tap to stop.");
  const tick = () => {
    if (S.rec !== rec) return;
    const t = (performance.now() - rec.t0) / 1000;
    $("#recTime").textContent = fmtT(t);
    if (rec.speaking && !$("#recBtn").classList.contains("live")) micState("live", "Recording…", "Stops by itself when you finish");
    drawLiveWave(rec.levels, rec.speaking);
    if (rec.done === "nospeech") { stopRec(true); toast("We didn't hear you speak. Check your microphone and try again.", true); return; }
    if (rec.done === "auto" || t >= MAX_REC_S) { stopRec(); return; }
    requestAnimationFrame(tick);
  };
  tick();
}

async function stopRec(discard = false) {
  const rec = S.rec; if (!rec) return;
  S.rec = null;
  rec.proc.disconnect(); rec.src.disconnect(); rec.stream.getTracks().forEach((t) => t.stop());
  const n = rec.chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n);
  let o = 0; for (const c of rec.chunks) { all.set(c, o); o += c.length; }
  const rate = rec.ctx.sampleRate; rec.ctx.close();
  idleMic();
  if (discard) { drawWave(); return; }
  if (n < rate * 0.5) { toast("That recording was too short. Read the whole sentence.", true); drawWave(); return; }
  setAudio(await to16k(all, rate), "Recording");
}

function beep() {
  try {
    const c = new AudioContext(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.16);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.18); setTimeout(() => c.close(), 400);
  } catch (e) {}
}
function shadow() {
  S.shadowing = true;
  micState("waiting", "Listen…", "The correct version is playing. Tap to cancel.");
  speakRef(sentence(), "normal", () => {
    if (!S.shadowing) return;
    S.shadowing = false; beep();
    setTimeout(startRec, 220);
  });
}
function micPressed() {
  if (S.rec) return stopRec();
  if (S.shadowing) { stopRef(); return; }
  if (S.mode === "shadow") shadow(); else startRec();
}
$("#recBtn").addEventListener("click", micPressed);
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, select, textarea, button, label, dialog, [contenteditable]")) return;
  e.preventDefault(); micPressed();
});

$("#fileIn").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await f.arrayBuffer()); ctx.close();
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
    setAudio(await to16k(mono, buf.sampleRate), f.name);
  } catch (err) { toast("This file could not be read as audio. Try a WAV, MP3, M4A or WebM file.", true); }
});

function setAudio(data, label) {
  S.audio = data; S.result = null; S.sel = -1;
  $("#recMeta").textContent = `${label === "Recording" ? "Your recording" : label} · ${dur().toFixed(1)} s`;
  $("#recTime").textContent = fmtT(dur());
  $("#playBtn").disabled = false; $("#analyzeBtn").disabled = false;
  S.spec = computeSpec(data); S.pitch = computePitch(data);
  idleMic(); renderResult(); redrawAll();
  analyze();
}

/* ================= analysis ================= */
function wav16(data) {
  const n = data.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, data[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

async function analyze() {
  if (!S.audio) return;
  const meta = $("#recMeta"), btn = $("#analyzeBtn");
  btn.disabled = true; meta.className = "sub analyzing"; meta.textContent = "Analysing every sound…";
  const fd = new FormData();
  fd.append("audio", wav16(S.audio), "recording.wav"); fd.append("text", sentence());
  try {
    const r = await fetch("/analyze", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `The server returned an error (${r.status}).`);
    S.result = j;
    const firstBad = j.phones.findIndex((p) => kindOf(p) === "bad");
    S.sel = firstBad >= 0 ? firstBad : j.phones.findIndex((p) => kindOf(p) === "alm");
    saveHistory(j);
    if (S.drill) S.drill.scores[S.drill.i] = j.overall;
    meta.className = "sub"; meta.textContent = `Your recording · ${dur().toFixed(1)} s`;
    renderResult(); redrawAll(); renderDrills();
    const res = $("#results").getBoundingClientRect();
    if (res.top > window.innerHeight * 0.7) $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    S.result = null; meta.className = "sub"; meta.textContent = String(e.message || e);
    toast(String(e.message || e), true); renderResult(); redrawAll();
  } finally { btn.disabled = !S.audio; }
}
$("#analyzeBtn").addEventListener("click", analyze);

/* ================= sentence flow ================= */
function clearAttempt() {
  if (S.rec) stopRec(true);
  S.shadowing = false; S.cmpRun++;
  S.audio = null; S.result = null; S.spec = null; S.pitch = null; S.sel = -1; stopPlay(); stopRef();
  $("#playBtn").disabled = true; $("#analyzeBtn").disabled = true;
  $("#recMeta").className = "sub"; $("#recMeta").textContent = "Recording stops by itself when you finish speaking.";
  $("#recTime").textContent = "0:00";
  idleMic(); renderResult(); redrawAll();
}
function sentenceChanged(msg) {
  const had = S.audio || S.result;
  clearAttempt(); refreshRef(); renderDrillBar();
  const pc = $("#practice"); pc.classList.remove("flash"); void pc.offsetWidth; pc.classList.add("flash");
  if (msg) toast(msg); else if (had) toast("New sentence. Listen to it, then record.");
}
$("#againBtn").addEventListener("click", () => { clearAttempt(); $("#practice").scrollIntoView({ behavior: "smooth", block: "start" }); micPressed(); });
$("#nextBtn").addEventListener("click", () => {
  if (S.drill) return nextDrillItem();
  const sel = $("#promptSel");
  if ($("#customText").value.trim()) $("#customText").value = "";
  else sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
  sentenceChanged(`Next sentence: “${sentence()}”`);
});
$("#resetBtn").addEventListener("click", () => {
  S.drill = null; $("#customText").value = ""; $("#promptSel").selectedIndex = 0;
  sentenceChanged("Started a new session. Your progress history is kept.");
  showTab("acoustic"); window.scrollTo({ top: 0, behavior: "smooth" });
});
let refT; const refSoon = () => { clearTimeout(refT); refT = setTimeout(() => (S.audio || S.result ? sentenceChanged() : refreshRef()), 450); };
$("#promptSel").addEventListener("change", () => { $("#customText").value = ""; sentenceChanged(); });
$("#customText").addEventListener("input", refSoon);
$("#customText").addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(refT); sentenceChanged(); e.target.blur(); } });
$("#scoreInfo").addEventListener("click", () => $("#scoreDlg").showModal());

/* ================= reference voice ================= */
let refAudio = null;
function stopRef() {
  if (refAudio) { refAudio.onended = null; refAudio.onerror = null; refAudio.pause(); refAudio = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $$(".sw.speaking, .cw.now").forEach((e) => e.classList.remove("speaking", "now"));
  $("#refPlay").classList.remove("loading"); $("#refPlay").textContent = "▶ Listen";
  if (S.shadowing) { S.shadowing = false; idleMic(); }
}
function browserVoice(text, rate, done) {
  if (!("speechSynthesis" in window)) { toast("No voice is available in this browser.", true); done && done(); return; }
  const u = new SpeechSynthesisUtterance(text), v = speechSynthesis.getVoices();
  u.voice = v.find((x) => x.lang === "en-IN") || v.find((x) => x.lang.startsWith("en")) || null;
  u.rate = rate === "slow" ? 0.7 : 0.95; u.onend = () => done && done();
  speechSynthesis.speak(u);
}
/* Play `text` in the reference voice; `done` runs when it finishes. `el` is highlighted meanwhile. */
function speakRef(text, rate = "normal", done, el) {
  const keepShadow = S.shadowing;
  stopPlay();
  if (refAudio) { refAudio.onended = null; refAudio.onerror = null; refAudio.pause(); refAudio = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $$(".sw.speaking").forEach((e) => e.classList.remove("speaking"));
  S.shadowing = keepShadow;
  const btn = $("#refPlay"), whole = !el && text === sentence();
  if (whole) { btn.classList.add("loading"); btn.textContent = "… Loading"; }
  if (el) el.classList.add(el.classList.contains("cw") ? "now" : "speaking");
  const a = new Audio(`/tts?${new URLSearchParams({ text, rate, voice: S.voice })}`);
  refAudio = a;
  const finish = () => {
    if (refAudio === a) refAudio = null;
    if (el) el.classList.remove("speaking", "now");
    btn.classList.remove("loading"); btn.textContent = "▶ Listen";
    done && done();
  };
  a.onplaying = () => { if (whole) btn.textContent = "■ Stop"; };
  a.onended = finish;
  a.onerror = () => {
    if (refAudio !== a) return;
    refAudio = null; toast("The online voice is unavailable, so your browser's voice is used instead.");
    browserVoice(text, rate, finish);
  };
  a.play().catch(() => {});
}
async function refreshRef() {
  const text = sentence(), box = $("#refWords");
  try {
    const r = await (await fetch(`/pronounce?${new URLSearchParams({ text })}`)).json();
    if (text !== sentence()) return;
    S.refWords = r.words || [];
  } catch (e) { S.refWords = (text.match(/[A-Za-z']+/g) || []).map((w) => ({ word: w, phones: [] })); }
  box.innerHTML = S.refWords.length
    ? S.refWords.map((w, i) => `<button class="sw" data-rw="${i}" title="Hear “${esc(w.word)}” slowly"><b>${esc(w.word)}</b><small>/${esc(w.phones.join(""))}/</small></button>`).join("")
    : `<span class="empty">Type a sentence with English words.</span>`;
  markSentence();
}
function markSentence() {
  const cur = resultIsCurrent();
  $$(".sw").forEach((b) => {
    const i = +b.dataset.rw, k = cur && S.result.words[i] ? wordKind(i) : null;
    ["ok", "bad", "alm", "var"].forEach((c) => b.classList.toggle(c, k === c));
  });
  $("#legend").hidden = !cur;
  $("#sentHint").hidden = cur;
}
$("#refWords").addEventListener("click", (e) => { const b = e.target.closest(".sw"); if (b) speakRef(S.refWords[+b.dataset.rw].word, "slow", null, b); });
$("#refPlay").addEventListener("click", () => (refAudio || $("#refPlay").classList.contains("loading") ? stopRef() : speakRef(sentence(), "normal")));
$("#refSlow").addEventListener("click", () => speakRef(sentence(), "slow"));

/* ================= rendering ================= */
function renderResult() {
  const r = S.result;
  $("#intro").hidden = !!r;
  $("#summary").hidden = !r; $("#focus").hidden = !r; $("#compare").hidden = !r;
  markSentence();
  if (r) {
    const score = Math.round(r.overall);
    $("#scoreNum").textContent = score;
    $("#ringArc").setAttribute("stroke-dasharray", `${(289 * score) / 100} 289`);
    const sm = r.summary || { total: r.phones.length, error: r.phones.filter((p) => !p.ok).length, almost: 0, variant: 0 };
    const bad = r.phones.filter((p) => kindOf(p) === "bad"), badWords = [...new Set(bad.map((p) => p.word))];
    const good = sm.total - sm.error - sm.almost;
    $("#verdictH").textContent = sm.error === 0 && score >= 85 ? "Excellent!" : score >= 85 ? "Very good" : score >= 70 ? "Good work" : score >= 50 ? "Getting there" : "Keep practising";
    $("#verdictP").textContent = bad.length
      ? `${good} of ${sm.total} sounds clear. Work on ${badWords.map((w) => `“${w}”`).join(", ")}.`
      : sm.almost ? `${good} of ${sm.total} sounds clear; the rest were close.` : `All ${sm.total} sounds were clear.`;
    $("#tally").innerHTML = [["ok", good - sm.variant, "clear"], ["var", sm.variant, "Indian-English"], ["alm", sm.almost, "almost"], ["bad", sm.error, "need work"]]
      .filter(([, n]) => n > 0).map(([k, n, l]) => `<span class="c-${k}">${KIND_ICON[k]} ${n} ${l}</span>`).join("");
    $("#againBtn").textContent = S.mode === "shadow" ? "↻ Listen & repeat again" : "↻ Try again";
  }
  renderFocus(); renderCompare(); renderTables();
}

function issues() { return S.result ? S.result.phones.map((p, i) => ({ p, i, k: kindOf(p) })).filter(({ k }) => k === "bad" || k === "alm") : []; }

function renderFocus() {
  const r = S.result; if (!r) return;
  const list = issues(), focus = $("#focus");
  $("#issuePills").innerHTML = list.map(({ p, i, k }) => `<button role="tab" class="c-${k}${i === S.sel ? " on" : ""}" data-ph="${i}" title="${KIND_LABEL[k]} in “${esc(p.word)}”">/${esc(p.expected)}/ ${esc(p.word)}</button>`).join("");
  const p = S.sel >= 0 ? r.phones[S.sel] : null;
  focus.classList.toggle("clear", !p);
  if (!p) {
    $("#focusEyebrow").textContent = "Focus sound";
    $("#mouths").innerHTML = "";
    $("#focusH").textContent = "Nothing to fix in this sentence";
    $("#focusP").textContent = "Every sound was clear. Try the next sentence, switch on Shadowing, or pick a sound drill below.";
    $("#focusCues").innerHTML = ""; $("#playSeg").hidden = true; $("#sayWord").hidden = true; $("#drillBtn").hidden = true;
    return;
  }
  const k = kindOf(p), M = window.PLMouth;
  $("#focusEyebrow").textContent = KIND_LABEL[k];
  $("#focusEyebrow").style.color = KIND_COLOR[k];
  let figs = "";
  if (M.has(p.expected)) figs += `<figure>${M.svg(p.expected, { tone: "target", id: "aim" })}<figcaption class="aim">Aim for /${esc(p.expected)}/</figcaption></figure>`;
  if ((k === "bad" || k === "alm") && p.heard !== "-" && p.heard !== p.expected && M.has(p.heard))
    figs += `<figure>${M.svg(p.heard, { tone: "yours", id: "you" })}<figcaption class="yours">Yours sounded like /${esc(p.heard)}/</figcaption></figure>`;
  $("#mouths").innerHTML = figs;
  $(".focus-body").classList.toggle("two", (figs.match(/<figure>/g) || []).length > 1);
  const c = M.cues(p.expected);
  $("#focusH").textContent = `${c ? c.name : `/${p.expected}/`} · “${p.word}”`;
  const heard = p.heard === "-" ? "It was faint or missing" : `It sounded like /${p.heard}/`;
  const tip = p.tip && !/^(Expected|The sound|An extra)/.test(p.tip) ? p.tip : (p.heard === "-" ? "Say it clearly and hold it a moment." : "");
  $("#focusP").textContent = k === "bad" ? `${heard}. ${tip}`
    : k === "alm" ? `Close. ${heard}, but it still scored ${Math.round(p.score)}. ${tip}`
    : k === "var" ? (p.heard === "-" ? "You left out the /r/. Many fluent Indian-English speakers do, so it doesn't count against you." : `You said /${p.heard}/, a standard Indian-English way to say /${p.expected}/. It doesn't count against you.`)
    : `Clear, with a score of ${Math.round(p.score)}.`;
  $("#focusCues").innerHTML = c ? `<dt>Lips</dt><dd>${esc(c.lips)}</dd><dt>Tongue</dt><dd>${esc(c.tongue)}</dd><dt>Voice</dt><dd>${esc(c.voice)}</dd>` : "";
  $("#playSeg").hidden = p.start == null; $("#sayWord").hidden = false;
  const set = window.PLDrills.forPhone(p.expected);
  $("#drillBtn").hidden = !set || (S.drill && S.drill.set === set);
  if (set) $("#drillBtn").textContent = `🎯 Practise ${set.title} (5 sentences)`;
}
function selectPhone(i, playIt) {
  S.sel = i; renderFocus(); drawSpec();
  $$(".pr").forEach((b) => b.classList.toggle("sel", +b.dataset.ph === i));
  const p = S.result.phones[i];
  if (playIt && p.start != null) playRange(Math.max(0, p.start - 0.08), Math.min(dur(), p.end + 0.08));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ph]"); if (!b || !S.result) return;
  const fromList = b.classList.contains("pr");
  selectPhone(+b.dataset.ph, fromList);
  if (fromList) $("#focus").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("#playSeg").addEventListener("click", () => { const p = S.result?.phones[S.sel]; if (p && p.start != null) playRange(Math.max(0, p.start - 0.08), Math.min(dur(), p.end + 0.08)); });
$("#sayWord").addEventListener("click", () => { const p = S.result?.phones[S.sel]; if (p) speakRef(p.word, "slow"); });
$("#drillBtn").addEventListener("click", () => { const p = S.result?.phones[S.sel]; const set = p && window.PLDrills.forPhone(p.expected); if (set) startDrill(set.id); });

/* ---------- side-by-side comparison ---------- */
function wordSpans() {
  const r = S.result; if (!r) return [];
  return r.words.map((w, wi) => {
    const ps = r.phones.filter((p) => p.word_index === wi && p.start != null);
    return { wi, word: w.word, start: ps.length ? Math.min(...ps.map((p) => p.start)) : null, end: ps.length ? Math.max(...ps.map((p) => p.end)) : null, kind: wordKind(wi) };
  });
}
function renderCompare() {
  const r = S.result; if (!r) { $("#lanes").innerHTML = ""; return; }
  const cols = r.words.map((w, wi) => {
    const ps = r.phones.filter((p) => p.word_index === wi), k = wordKind(wi);
    const exp = ps.map((p) => p.expected).join(""), you = ps.map((p) => (p.heard === "-" ? "·" : p.heard)).join("");
    return { wi, w: w.word, k, exp, you };
  });
  const lane = (cls, f) => `<div class="lane-words">${cols.map(f).join("")}</div>`;
  $("#lanes").innerHTML =
    `<span class="lane-lab">Correct</span><div class="lane">${lane("ref", (c) => `<button class="cw ref" data-cw="${c.wi}" title="Compare “${esc(c.w)}”"><b>${esc(c.w)}</b><small>/${esc(c.exp)}/</small></button>`)}</div>` +
    `<span class="lane-lab">You</span><div class="lane">${lane("you", (c) => `<button class="cw ${c.k === "ok" ? "" : c.k}" data-cw="${c.wi}" title="${KIND_LABEL[c.k]}"><b>${esc(c.w)} ${KIND_ICON[c.k]}</b><small>/${esc(c.you)}/</small></button>`)}</div>`;
}
function compareWord(wi, done) {
  const sp = wordSpans()[wi]; if (!sp) return done && done();
  const run = S.cmpRun;
  const [refEl, youEl] = $$(`.cw[data-cw="${wi}"]`);
  speakRef(sp.word, "slow", () => {
    if (run !== S.cmpRun) return;
    if (sp.start == null) return done && done();
    youEl && youEl.classList.add("now");
    setTimeout(() => playRange(Math.max(0, sp.start - 0.05), Math.min(dur(), sp.end + 0.08), () => {
      youEl && youEl.classList.remove("now");
      if (run === S.cmpRun) setTimeout(() => done && done(), 350);
    }), 250);
  }, refEl);
}
$("#lanes").addEventListener("click", (e) => { const b = e.target.closest(".cw"); if (b) { S.cmpRun++; compareWord(+b.dataset.cw); } });
$("#cmpBoth").addEventListener("click", () => { S.cmpRun++; const run = S.cmpRun; speakRef(sentence(), "normal", () => { if (run === S.cmpRun) setTimeout(() => playRange(), 400); }); });
$("#cmpWords").addEventListener("click", () => {
  const btn = $("#cmpWords");
  if (btn.dataset.running) { S.cmpRun++; stopRef(); stopPlay(); btn.textContent = "⇄ Word by word"; delete btn.dataset.running; return; }
  const only = $("#cmpOnlyBad").checked;
  const order = wordSpans().filter((s) => !only || s.kind === "bad" || s.kind === "alm").map((s) => s.wi);
  if (!order.length) { toast("No words to work on in this sentence."); return; }
  S.cmpRun++; const run = S.cmpRun; btn.dataset.running = "1"; btn.textContent = "■ Stop";
  const step = (n) => {
    if (run !== S.cmpRun || n >= order.length) { btn.textContent = "⇄ Word by word"; delete btn.dataset.running; return; }
    compareWord(order[n], () => step(n + 1));
  };
  step(0);
});

/* ---------- tables, lists ---------- */
function renderTables() {
  const r = S.result;
  $("#prList").innerHTML = r
    ? r.phones.map((p, i) => {
        const k = kindOf(p);
        return `<button class="pr${i === S.sel ? " sel" : ""}" data-ph="${i}"><b>/${esc(p.expected)}/</b><span class="t"><i style="color:${KIND_COLOR[k]}">${KIND_ICON[k]}</i>“${esc(p.word)}” · heard /${esc(p.heard)}/</span><span class="bar" title="score ${Math.round(p.score)}"><i style="width:${Math.max(3, Math.min(100, p.score))}%;background:${KIND_COLOR[k]}"></i></span></button>`;
      }).join("")
    : `<div class="empty">Every sound with its score appears here after you record.</div>`;
  $("#vowelRows").innerHTML = r && r.vowels.length
    ? r.vowels.map((v) => {
        const n = S.norms[v.phone]; let d = "—";
        if (n && v.zF1 != null) d = Math.hypot((v.zF1 - n.zF1) / n.zF1_sd, (v.zF2 - n.zF2) / n.zF2_sd).toFixed(2) + " SD";
        return `<tr><td><b>/${esc(v.phone)}/</b></td><td>${esc(v.word)}</td><td class="num">${v.F1 != null ? Math.round(v.F1) : "—"}</td><td class="num">${v.F2 != null ? Math.round(v.F2) : "—"}</td><td class="num">${d}</td><td><span class="tag-s c-${v.ok ? "ok" : "bad"}">${v.ok ? "OK" : "Needs work"}</span></td></tr>`;
      }).join("")
    : `<tr><td colspan="6" class="empty">${r ? "Not enough clear vowels to measure in this recording." : "Your measured vowels appear here after you record."}</td></tr>`;
}

/* ================= drills ================= */
function startDrill(id) {
  const set = window.PLDrills.SETS.find((s) => s.id === id); if (!set) return;
  S.drill = { set, i: 0, scores: [] };
  sentenceChanged(`Drill: ${set.title}. Five short sentences.`);
  window.scrollTo({ top: $("#practice").offsetTop - 12, behavior: "smooth" });
}
function nextDrillItem() {
  const d = S.drill; if (!d) return;
  if (d.i + 1 >= d.set.items.length) {
    const done = d.scores.filter((x) => x != null);
    S.drill = null;
    sentenceChanged(done.length ? `Drill complete: average score ${Math.round(done.reduce((a, b) => a + b, 0) / done.length)} over ${done.length} sentences.` : "Drill complete.");
    return;
  }
  d.i += 1; sentenceChanged(`Sentence ${d.i + 1} of ${d.set.items.length}`);
}
function renderDrillBar() {
  const d = S.drill, bar = $("#drillBar");
  bar.hidden = !d;
  $("#promptSel").disabled = !!d; $("#customText").disabled = !!d;
  $("#nextBtn").textContent = d ? (d.i + 1 >= d.set.items.length ? "Finish drill ✓" : "Next drill sentence →") : "Next sentence →";
  if (!d) return;
  $("#drillName").textContent = `Drill: ${d.set.title}`; $("#drillHint").textContent = d.set.hint;
  $("#drillDots").innerHTML = d.set.items.map((_, i) => `<i class="${i < d.i ? "done" : i === d.i ? "cur" : ""}"></i>`).join("");
  $("#drillCount").textContent = `${d.i + 1} of ${d.set.items.length}`;
}
$("#drillExit").addEventListener("click", () => { S.drill = null; sentenceChanged("Drill closed."); });
function currentIssues() { return issues().map(({ p, k }) => [p.expected, p.heard, k]); }
function renderDrills() {
  const recs = window.PLDrills.recommend(loadHistory(), currentIssues(), 3), recIds = new Set(recs.map((r) => r.set.id));
  $("#drillRec").innerHTML = recs.length
    ? `<div class="recbox"><span>🎯</span><div style="flex:1;min-width:200px"><b>Recommended for you: ${esc(recs[0].set.title)}</b><br><span class="sub">This sound came up in your recent practice.</span></div><button class="btn sm" data-drill="${recs[0].set.id}">Start drill</button></div>`
    : `<p class="sub panel-sub">Pick a sound to practise. After a few sessions, PhonoLens recommends drills for the sounds you find hardest.</p>`;
  $("#drillGrid").innerHTML = window.PLDrills.SETS.map((s) => `<button class="dcard${recIds.has(s.id) ? " rec" : ""}" data-drill="${s.id}"><b>${esc(s.title)}</b><span>${esc(s.hint)} · 5 sentences</span></button>`).join("");
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-drill]"); if (b) startDrill(b.dataset.drill); });

/* ================= DSP for display ================= */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], h = i + k + len / 2;
        const vr = re[h] * cr - im[h] * ci, vi = re[h] * ci + im[h] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[h] = ur - vr; im[h] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function computeSpec(x) {
  const N = 512, hop = 160, bins = N / 2, frames = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const db = new Float32Array(frames * bins); let mx = -1e9;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < N; i++) { const p = o + i; const s = p < x.length ? x[p] - (p > 0 ? 0.97 * x[p - 1] : 0) : 0; re[i] = s * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < bins; b++) { const v = 10 * Math.log10(re[b + 1] ** 2 + im[b + 1] ** 2 + 1e-12); db[f * bins + b] = v; if (v > mx) mx = v; }
  }
  return { db, frames, bins, mx };
}
function computePitch(x) {
  const hop = 160, N = 640, lagMin = Math.floor(SR / 400), lagMax = Math.ceil(SR / 70);
  const frames = Math.max(1, Math.floor((x.length - N) / hop) + 1), out = new Float32Array(frames).fill(NaN);
  const rms = new Float32Array(frames); let mr = 0;
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < N; i++) s += (x[f * hop + i] || 0) ** 2; rms[f] = Math.sqrt(s / N); mr = Math.max(mr, rms[f]); }
  for (let f = 0; f < frames; f++) {
    if (rms[f] < 0.08 * mr) continue;
    const o = f * hop; let r0 = 0; for (let i = 0; i < N; i++) r0 += x[o + i] ** 2;
    let best = 0, bl = 0;
    for (let l = lagMin; l <= lagMax; l++) { let r = 0; for (let i = 0; i < N - l; i++) r += x[o + i] * x[o + i + l]; r /= r0; if (r > best) { best = r; bl = l; } }
    if (best > 0.5 && bl) out[f] = SR / bl;
  }
  for (let f = 1; f < frames - 1; f++) if (!isNaN(out[f]) && isNaN(out[f - 1]) && isNaN(out[f + 1])) out[f] = NaN;
  return out;
}

/* ================= canvases ================= */
function drawLiveWave(levels, speaking) {
  const { x, w, h } = fit($("#wave")); x.clearRect(0, 0, w, h);
  const n = Math.floor(w / 5), lv = levels.slice(-n);
  x.fillStyle = speaking ? css("--bad") : css("--ok");
  lv.forEach((m, i) => { const bh = Math.max(2, Math.min(1, m * 2.5) * h); x.fillRect(i * 5, (h - bh) / 2, 3, bh); });
}
function drawWave(progress = -1) {
  const { x, w, h } = fit($("#wave")); x.clearRect(0, 0, w, h);
  const n = Math.floor(w / 5);
  if (!S.audio) { x.fillStyle = css("--line2"); for (let i = 0; i < n; i++) x.fillRect(i * 5, h / 2 - 1, 3, 2); return; }
  const a = S.audio, step = Math.floor(a.length / n) || 1; let mx = 0.05; const env = [];
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(a.length, (i + 1) * step); j += 4) m = Math.max(m, Math.abs(a[j])); env.push(m); mx = Math.max(mx, m); }
  const played = progress >= 0 ? progress * n : -1;
  env.forEach((m, i) => { const bh = Math.max(2, (m / mx) * h * 0.95); x.fillStyle = i < played ? css("--accent") : css("--accent2"); x.fillRect(i * 5, (h - bh) / 2, 3, bh); });
}
function drawSpec() {
  const c = $("#spec"), { x, w, h } = fit(c);
  $("#specEmpty").hidden = !!S.spec;
  x.clearRect(0, 0, w, h);
  if (!S.spec) return;
  const { db, frames, bins, mx } = S.spec;
  const stops = ["--s0", "--s1", "--s2", "--s3"].map((n) => hexRgb(css(n)));
  const col = (v) => { v = Math.min(1, Math.max(0, v)) * 3; const i = Math.min(2, Math.floor(v)), f = v - i; return stops[i].map((a, j) => a + (stops[i + 1][j] - a) * f); };
  const off = document.createElement("canvas"); off.width = frames; off.height = bins;
  const ox = off.getContext("2d"), img = ox.createImageData(frames, bins), floor = mx - 70;
  for (let f = 0; f < frames; f++) for (let b = 0; b < bins; b++) {
    const v = Math.max(0, (db[f * bins + b] - floor) / 70), [r, g, bb] = col(v * v * 1.15), k = ((bins - 1 - b) * frames + f) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = bb; img.data[k + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  x.imageSmoothingEnabled = true; x.drawImage(off, 0, 0, w, h);
  const D = dur();
  x.strokeStyle = "rgba(255,255,255,.35)"; x.setLineDash([3, 4]); x.lineWidth = 1;
  wordSpans().forEach((s) => { if (s.start == null) return; [s.start, s.end].forEach((t) => { const X = (t / D) * w; x.beginPath(); x.moveTo(X, 0); x.lineTo(X, h); x.stroke(); }); });
  x.setLineDash([]);
  const sel = S.result && S.sel >= 0 ? S.result.phones[S.sel] : null;
  if (sel && sel.start != null) {   // outline the selected sound without hiding the picture under it
    const X0 = (sel.start / D) * w, X1 = (sel.end / D) * w;
    x.strokeStyle = css("--accent2"); x.lineWidth = 2; x.strokeRect(X0 + 1, 1, Math.max(3, X1 - X0 - 2), h - 2);
  }
}
function drawPitch() {
  const { x, w, h } = fit($("#pitch")); x.clearRect(0, 0, w, h);
  if (!S.audio) return;
  const a = S.audio, n = Math.floor(w / 3), step = Math.floor(a.length / n) || 1;
  x.strokeStyle = css("--muted"); x.globalAlpha = 0.4; x.lineWidth = 1;
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(a.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(a[j])); const bh = Math.max(1, m * 18); x.beginPath(); x.moveTo(i * 3, h - 10 - bh / 2); x.lineTo(i * 3, h - 10 + bh / 2); x.stroke(); }
  x.globalAlpha = 1;
  if (!S.pitch) return;
  const p = S.pitch, fr = p.length, y = (f) => h - 22 - ((Math.min(350, Math.max(70, f)) - 70) / 280) * (h - 26);
  x.strokeStyle = css("--accent"); x.lineWidth = 2.5; x.lineJoin = "round";
  let open = false; x.beginPath();
  for (let i = 0; i < fr; i++) { const X = (i / fr) * w; if (isNaN(p[i])) { open = false; continue; } open ? x.lineTo(X, y(p[i])) : x.moveTo(X, y(p[i])); open = true; }
  x.stroke();
}
function drawWordBar() {
  const bar = $("#wordBar"), D = dur();
  bar.innerHTML = S.result ? wordSpans().filter((s) => s.start != null).map((s) => {
    const cls = s.kind === "bad" ? "flag" : s.kind === "ok" ? "" : s.kind;
    return `<span class="${cls}" style="left:${(s.start / D) * 100}%;width:calc(${((s.end - s.start) / D) * 100}% - 2px)" title="${esc(s.word)}">${esc(s.word)}</span>`;
  }).join("") : "";
  $("#durLab").textContent = S.audio ? `${D.toFixed(1)} s` : "—";
}
function drawVowels() {
  const svg = $("#vowel"), ns = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  const el = (n, a, t) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); if (t != null) e.textContent = t; svg.appendChild(e); return e; };
  const X0 = 40, X1 = 250, Y0 = 50, Y1 = 262, L = 2.6;
  const px = (z2) => X0 + ((L - Math.max(-L, Math.min(L, z2))) / (2 * L)) * (X1 - X0);
  const py = (z1) => Y0 + ((Math.max(-L, Math.min(L, z1)) + L) / (2 * L)) * (Y1 - Y0);
  const muted = css("--muted"), acc = css("--accent");
  el("rect", { x: 118, y: 10, width: 9, height: 9, rx: 2, fill: acc, "fill-opacity": 0.3 });
  el("text", { x: 131, y: 18, "font-size": 11, fill: muted }, "Indian English norm");
  el("circle", { cx: 122.5, cy: 31, r: 4.5, fill: css("--ok") });
  el("text", { x: 131, y: 35, "font-size": 11, fill: muted }, "You");
  el("line", { x1: X0, y1: Y0, x2: X0, y2: Y1, stroke: css("--line") });
  el("line", { x1: X0, y1: Y1, x2: X1, y2: Y1, stroke: css("--line") });
  for (const [v, n] of Object.entries(S.norms)) {
    el("ellipse", { cx: px(n.zF2), cy: py(n.zF1), rx: (n.zF2_sd / (2 * L)) * (X1 - X0), ry: (n.zF1_sd / (2 * L)) * (Y1 - Y0), fill: acc, "fill-opacity": 0.06, stroke: acc, "stroke-opacity": 0.28 });
    el("text", { x: px(n.zF2), y: py(n.zF1) + 4, "text-anchor": "middle", "font-size": 12, fill: muted }, v);
  }
  const vs = (S.result && S.result.vowels) || [];
  vs.forEach((v) => {
    if (v.zF1 == null || v.zF2 == null) return;
    const c = v.ok ? css("--ok") : css("--bad");
    const dot = el("circle", { cx: px(v.zF2), cy: py(v.zF1), r: 5.5, fill: c, stroke: css("--panel"), "stroke-width": 1.5 });
    const t = document.createElementNS(ns, "title"); t.textContent = `/${v.phone}/ in "${v.word}" · F1 ${v.F1 ?? "?"} Hz, F2 ${v.F2 ?? "?"} Hz`; dot.appendChild(t);
  });
  el("text", { x: (X0 + X1) / 2, y: 288, "text-anchor": "middle", "font-size": 11, fill: muted }, "tongue front  ←  →  back");
  el("text", { x: 16, y: (Y0 + Y1) / 2, "font-size": 11, fill: muted, transform: `rotate(-90 16 ${(Y0 + Y1) / 2})`, "text-anchor": "middle" }, "tongue high  ←  →  low");
  if (!vs.length) el("text", { x: (X0 + X1) / 2, y: Y1 - 10, "text-anchor": "middle", "font-size": 11, fill: muted }, S.result ? "Not enough vowels to measure" : "Your vowels appear here");
}
function redrawAll() { drawWave(); drawSpec(); drawPitch(); drawWordBar(); drawVowels(); }

/* ================= playback of your recording ================= */
let pctx = null;
function stopPlay() {
  if (S.play) { const p = S.play; S.play = null; try { p.src.onended = null; p.src.stop(); } catch (e) {} cancelAnimationFrame(p.raf); }
  $("#playBtn").textContent = "▶"; $("#playBtn").setAttribute("aria-label", "Play your recording");
  ["#ph1", "#ph2"].forEach((s) => ($(s).style.display = "none"));
  drawWave();
}
function playRange(from = 0, to = dur(), onEnd) {
  if (!S.audio) return;
  stopPlay();
  if (refAudio) { refAudio.onended = null; refAudio.pause(); refAudio = null; }
  pctx = pctx || new AudioContext();
  const b = pctx.createBuffer(1, S.audio.length, SR); b.copyToChannel(S.audio, 0);
  const src = pctx.createBufferSource(); src.buffer = b; src.connect(pctx.destination);
  src.start(0, from, Math.max(0.05, to - from));
  const st = { src, t0: pctx.currentTime, raf: 0 }; S.play = st;
  $("#playBtn").textContent = "❚❚"; $("#playBtn").setAttribute("aria-label", "Pause");
  src.onended = () => { if (S.play === st) { stopPlay(); onEnd && onEnd(); } };
  const tick = () => {
    if (S.play !== st) return;
    const t = from + (pctx.currentTime - st.t0), f = Math.min(1, t / dur());
    ["#ph1", "#ph2"].forEach((s) => { const el = $(s); el.style.display = "block"; el.style.left = `${f * 100}%`; });
    drawWave(f); st.raf = requestAnimationFrame(tick);
  };
  tick();
}
$("#playBtn").addEventListener("click", () => (S.play ? stopPlay() : playRange()));
const seek = (e) => { if (!S.audio) return; const r = e.currentTarget.getBoundingClientRect(); playRange(((e.clientX - r.left) / r.width) * dur()); };
["#spec", "#pitch", "#wave"].forEach((s) => $(s).addEventListener("click", seek));

/* ================= tabs + navigation ================= */
function showTab(t) {
  $$(".tabs button").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== t));
  if (t === "acoustic") { drawSpec(); drawPitch(); drawWordBar(); }
  if (t === "vowels") drawVowels();
  if (t === "progress") renderHistory();
  if (t === "drills") renderDrills();
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-nav]"); if (!n) return;
  const k = n.dataset.nav;
  if (k === "about") { $("#aboutDlg").showModal(); return; }
  $$(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.nav === k));
  if (k === "practice") window.scrollTo({ top: 0, behavior: "smooth" });
  else { showTab(k); $("#details").scrollIntoView({ behavior: "smooth", block: "start" }); }
});

/* ================= progress history (this browser only) ================= */
function loadHistory() { try { return JSON.parse(store.get("pl-history") || "[]"); } catch (e) { return []; } }
function saveHistory(r) {
  const h = loadHistory(), sm = r.summary || {};
  h.push({ t: Date.now(), text: r.text, overall: r.overall, total: sm.total ?? r.phones.length,
           clear: (sm.total ?? r.phones.length) - (sm.error ?? 0) - (sm.almost ?? 0), issues: currentIssues() });
  store.set("pl-history", JSON.stringify(h.slice(-100)));
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  const last = h[h.length - 1], prev = h[h.length - 2];
  $("#progSub").textContent = !h.length ? "Your scores are saved in this browser after each analysis."
    : `${h.length} session${h.length > 1 ? "s" : ""} · last score ${Math.round(last.overall)}` + (prev ? ` (${last.overall >= prev.overall ? "▲" : "▼"} ${Math.abs(Math.round(last.overall - prev.overall))} vs previous)` : "");
  $("#histRows").innerHTML = h.length
    ? h.slice(-12).reverse().map((e) => `<tr><td>${new Date(e.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(e.text)}</td><td class="num">${Math.round(e.overall)}</td><td class="num">${e.clear != null ? `${e.clear}/${e.total}` : "—"}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">No sessions yet.</td></tr>`;
  const svg = $("#progChart"), pts = h.slice(-20), W = 640, H = 200, P = 30;
  const X = (i) => P + (pts.length < 2 ? (W - 2 * P) / 2 : (i / (pts.length - 1)) * (W - 2 * P)), Y = (v) => H - P - (v / 100) * (H - 2 * P);
  let s = [0, 50, 80, 100].map((v) => `<line x1="${P}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${P - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${v}</text>`).join("");
  if (pts.length) {
    const line = pts.map((e, i) => `${X(i)},${Y(e.overall)}`).join(" ");
    s += `<polygon points="${X(0)},${Y(0)} ${line} ${X(pts.length - 1)},${Y(0)}" fill="var(--accent)" fill-opacity=".1"/><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;
    s += pts.map((e, i) => `<circle cx="${X(i)}" cy="${Y(e.overall)}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="var(--accent)"><title>${Math.round(e.overall)}</title></circle>`).join("");
  } else s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="var(--muted)">Your score history appears here</text>`;
  svg.innerHTML = s;
}
$("#clearHist").addEventListener("click", () => { store.set("pl-history", "[]"); renderHistory(); renderDrills(); toast("History cleared"); });

let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawDecor(); redrawAll(); }, 120); });
boot();
})();
