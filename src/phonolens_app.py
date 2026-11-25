"""
phonolens_app.py — inference engine, GOP features, Gradio UI and FastAPI backend.

Used by Notebook 3 (Colab) and by server.py (laptop). Requires phonolens_core.py next to it.

    engine = Engine(model_dir=".../phonolens-ft", assets_dir=".../phonolens-app")
    result = engine.analyze(wave_16k_float32, "The thin vest was very warm.")
"""
import json
import os
import re
import subprocess
import tempfile

import numpy as np

import phonolens_core as pc

SR = 16000
FRAME_S = 0.02                 # wav2vec2: one output frame per 20 ms
TOP_K_SUBS = 5                 # competitor phones tried per position for GOP

PROMPTS = [
    "The thin vest was very warm.",
    "This is the third Thursday of the month.",
    "Zebras at the zoo were very lazy.",
    "She sells sea shells on the seashore.",
    "The cat sat on a bad mat.",
    "Please wait at the gate for the boat.",
    "We were worried about the weather.",
    "Measure the pleasure of the treasure.",
]

FEATURES_GOP = ["gop_sub", "gop_del", "peak_lp", "mean_lp", "comp_peak", "dur", "rec_match",
                "is_vowel", "phone_id"]
FEATURES_CLASSICAL = ["zF1", "zF2", "formant_dev", "dur_ratio"]


# =============================================================================
# Pitch (fast) — used only to choose the formant analysis ceiling
# =============================================================================
def median_f0_fast(x, sr=SR):
    import librosa
    x = np.asarray(x, dtype=np.float32)
    if len(x) < sr * 0.1:
        return np.nan
    f0 = librosa.yin(x, fmin=60, fmax=400, sr=sr, frame_length=1024, hop_length=160)
    rms = librosa.feature.rms(y=x, frame_length=1024, hop_length=160)[0][:len(f0)]
    voiced = rms > 0.3 * rms.max()
    return float(np.median(f0[voiced])) if voiced.any() else np.nan


# =============================================================================
# GOP: CTC likelihood-ratio goodness of pronunciation
# =============================================================================
def ctc_nll(lp, seqs, device="cpu"):
    """Negative log-likelihood of each label sequence under the CTC posteriorgram lp (T, C)."""
    import torch
    T = lp.shape[0]
    B = len(seqs)
    x = torch.as_tensor(lp, dtype=torch.float32, device=device).unsqueeze(1).expand(T, B, lp.shape[1]).contiguous()
    lens = torch.tensor([len(s) for s in seqs], dtype=torch.long)
    flat = torch.tensor([t for s in seqs for t in s] or [1], dtype=torch.long)
    if lens.sum() == 0:
        flat = flat[:0]
    nll = torch.nn.functional.ctc_loss(x, flat, torch.full((B,), T, dtype=torch.long), lens,
                                       blank=0, reduction="none", zero_infinity=True)
    return nll.detach().cpu().numpy()


def gop_ctc(lp, canon_ids, spans, device="cpu", top_k=TOP_K_SUBS):
    """Alignment-free GOP from CTC likelihood ratios.

    gop_sub[k] = min over competitor phones q of  NLL(canon with k->q) - NLL(canon)
    gop_del[k] = NLL(canon without k) - NLL(canon)
    Positive = the canonical phone explains the audio better (well pronounced);
    negative = another phone, or nothing, explains it better (likely mispronounced).
    Competitors are the top_k phones with the highest posterior inside phone k's span.
    """
    N = len(canon_ids)
    seqs, owner = [list(canon_ids)], []
    for k in range(N):
        seqs.append(canon_ids[:k] + canon_ids[k + 1:]); owner.append(("del", k, None))
    best_q = []
    for k in range(N):
        s0, s1 = spans[k] if spans else (0, lp.shape[0] - 1)
        peak = lp[s0:s1 + 1, 1:].max(axis=0)                     # per phone (excl. blank)
        order = [q + 1 for q in np.argsort(-peak) if q + 1 != canon_ids[k]][:top_k]
        for q in order:
            seqs.append(canon_ids[:k] + [q] + canon_ids[k + 1:]); owner.append(("sub", k, q))
    nll = ctc_nll(lp, seqs, device)
    base = nll[0]
    gop_del = np.full(N, np.nan)
    gop_sub = np.full(N, np.inf)
    best = [None] * N
    for (kind, k, q), v in zip(owner, nll[1:]):
        d = v - base
        if kind == "del":
            gop_del[k] = d
        elif d < gop_sub[k]:
            gop_sub[k] = d; best[k] = q
    return gop_sub, gop_del, best


# =============================================================================
# Per-phone features (shared by training, evaluation, fairness check and the app)
# =============================================================================
def phone_features(lp, canon, wav=None, rec=None, norms=None, formant_kw=None, device="cpu",
                   with_formants=True):
    """lp: (T, 40) log-probs from the fine-tuned model; canon: list of phones.
    Returns a list of dicts, one per canonical phone."""
    ids = [pc.PH2ID[p] for p in canon]
    spans = pc.ctc_forced_align(lp, ids, blank=0)
    if rec is None:
        rec = [pc.ID2PH[i] for i in pc.ctc_greedy(lp.argmax(-1), blank=0)]
    rec_per = pc.realised_per_canonical(canon, rec)
    gop_sub, gop_del, best = gop_ctc(lp, ids, spans, device)

    rows = []
    for k, p in enumerate(canon):
        s0, s1 = spans[k] if spans else (np.nan, np.nan)
        if spans:
            seg = lp[s0:s1 + 1]
            peak = float(seg[:, ids[k]].max())
            mean = float(np.log(np.mean(np.exp(seg[:, ids[k]]))))
            comp = seg[:, 1:].copy(); comp[:, ids[k] - 1] = -np.inf
            comp_peak = float(comp.max())
            dur = int(s1 - s0 + 1)
        else:
            peak = mean = comp_peak = np.nan; dur = np.nan
        rows.append({"pos": k, "phone": p, "phone_id": ids[k], "is_vowel": int(p in pc.VOWELS),
                     "heard": rec_per[k], "rec_match": int(rec_per[k] == p),
                     "gop_sub": float(gop_sub[k]) if np.isfinite(gop_sub[k]) else np.nan,
                     "gop_del": float(gop_del[k]), "best_competitor": pc.ID2PH.get(best[k], None),
                     "peak_lp": peak, "mean_lp": mean, "comp_peak": comp_peak, "dur": dur,
                     "start": float(s0 * FRAME_S) if spans else np.nan,
                     "end": float((s1 + 1) * FRAME_S) if spans else np.nan,
                     "F1": np.nan, "F2": np.nan, "zF1": np.nan, "zF2": np.nan,
                     "formant_dev": np.nan, "dur_ratio": np.nan})

    # ---- classical acoustic features for vowels ----
    if with_formants and wav is not None and spans:
        kw = dict(formant_kw or {})
        t, F, _ = pc.track_formants(np.asarray(wav, dtype=np.float64), SR, median_f0_fast(wav), **kw)
        vidx = [r["pos"] for r in rows if r["phone"] in pc.MONOPHTHONGS and r["dur"] >= 2]
        for k in vidx:
            f1, f2, _ = pc.segment_formants(t, F, rows[k]["start"], rows[k]["end"])
            rows[k]["F1"], rows[k]["F2"] = float(f1), float(f2)
        ok = [k for k in vidx if 150 <= rows[k]["F1"] <= 1200 and 500 <= rows[k]["F2"] <= 3500]
        if len(ok) >= 3:                                       # Lobanov within the utterance
            F12 = np.array([[rows[k]["F1"], rows[k]["F2"]] for k in ok])
            mu, sd = F12.mean(0), F12.std(0)
            sd[sd == 0] = 1
            for k, (z1, z2) in zip(ok, (F12 - mu) / sd):
                rows[k]["zF1"], rows[k]["zF2"] = float(z1), float(z2)
    if norms:
        for r in rows:
            v = norms.get("vowels", {}).get(r["phone"])
            if v and np.isfinite(r["zF1"]):
                r["formant_dev"] = float(np.hypot((r["zF1"] - v["zF1"]) / v["zF1_sd"],
                                                  (r["zF2"] - v["zF2"]) / v["zF2_sd"]))
            d = norms.get("durations", {}).get(r["phone"])
            if d and np.isfinite(r["dur"]):
                r["dur_ratio"] = float(r["dur"] / d)
    return rows


def evidence(row):
    """Single 'how sure are we this phone is right' number used for thresholds."""
    vals = [v for v in (row["gop_sub"], row["gop_del"]) if v is not None and np.isfinite(v)]
    return min(vals) if vals else np.nan


def flag_strict(row):
    """Rule A: flag whenever the recognised phone differs from the canonical one."""
    return row["heard"] != row["phone"]


def flag_indian(row, thresholds, accept=pc.INDIAN_ENGLISH_ACCEPT):
    """Rule B (Indian-English-aware): flag only if
       (1) the recognised phone differs and the pair is not a standard Indian-English realisation, AND
       (2) the GOP evidence is worse than what 90% of fluent Indian-English speakers produce
           for that phone (per-phone threshold learned from IndicTTS)."""
    if row["heard"] == row["phone"] or (row["phone"], row["heard"]) in accept:
        return False
    thr = thresholds.get(row["phone"], thresholds.get("_global", 0.0))
    ev = evidence(row)
    return bool(np.isfinite(ev) and ev < thr)


# =============================================================================
# Engine
# =============================================================================
class Engine:
    def __init__(self, model_dir, assets_dir=None, device=None):
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.fe = Wav2Vec2FeatureExtractor.from_pretrained(model_dir)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_dir).to(self.device).eval()
        self.scorer, self.norms, self.thresholds, self.formant_kw = None, None, {"_global": 0.0}, {}
        if assets_dir and os.path.isdir(assets_dir):
            j = lambda n: os.path.join(assets_dir, n)
            if os.path.exists(j("scorer.joblib")):
                import joblib
                self.scorer = joblib.load(j("scorer.joblib"))
            if os.path.exists(j("norms.json")):
                self.norms = json.load(open(j("norms.json"), encoding="utf-8"))
            if os.path.exists(j("thresholds.json")):
                self.thresholds = json.load(open(j("thresholds.json"), encoding="utf-8"))
            if os.path.exists(j("formant_config.json")):
                self.formant_kw = json.load(open(j("formant_config.json")))

    def log_probs(self, wav):
        torch = self.torch
        with torch.no_grad():
            b = self.fe([np.asarray(wav, dtype=np.float32)], sampling_rate=SR, return_tensors="pt")
            with torch.autocast("cuda", dtype=torch.float16, enabled=(self.device == "cuda")):
                logits = self.model(b.input_values.to(self.device)).logits
            return torch.log_softmax(logits.float(), -1)[0].cpu().numpy()

    def score_rows(self, rows):
        """Human-like 0-2 accuracy score per phone (trained on speechocean762)."""
        if self.scorer is None:
            ev = np.array([evidence(r) for r in rows], dtype=float)
            return np.clip(2 / (1 + np.exp(-np.nan_to_num(ev, nan=0.0))), 0, 2)
        import pandas as pd
        cols = self.scorer["features"]
        X = pd.DataFrame([{c: r.get(c, np.nan) for c in cols} for r in rows])[cols].astype(float)
        return np.clip(self.scorer["model"].predict(X), 0, 2)

    def analyze(self, wav, text):
        wav = np.asarray(wav, dtype=np.float32)
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        if len(wav) < 0.5 * SR:
            return {"error": "The recording is too short. Please read the whole sentence."}
        if np.abs(wav).max() < 1e-4:
            return {"error": "The recording is silent. Check your microphone."}
        if np.abs(wav).max() > 0:
            wav = wav / np.abs(wav).max() * 0.9
        words = re.findall(r"[A-Za-z']+", text)
        word_phones = [pc.text_to_phones(w) for w in words]
        canon = [p for ph in word_phones for p in ph]
        if not canon:
            return {"error": "No English words found in the text."}
        lp = self.log_probs(wav)
        if lp.shape[0] < len(canon):
            return {"error": "The recording is too short for this sentence."}
        rows = phone_features(lp, canon, wav=wav, norms=self.norms, formant_kw=self.formant_kw,
                              device=self.device)
        scores = self.score_rows(rows)
        recognised = [pc.ID2PH[i] for i in pc.ctc_greedy(lp.argmax(-1), blank=0)]

        phones, k = [], 0
        for wi, (w, ph) in enumerate(zip(words, word_phones)):
            for _ in ph:
                r = rows[k]
                flagged = flag_indian(r, self.thresholds)
                accent_ok = r["heard"] != r["phone"] and (r["phone"], r["heard"]) in pc.INDIAN_ENGLISH_ACCEPT
                phones.append({
                    "word": w, "word_index": wi, "expected": r["phone"], "heard": r["heard"],
                    "ok": not flagged, "accent_variant": bool(accent_ok),
                    "score": round(float(scores[k]) * 50, 1),
                    "start": _num(r["start"]), "end": _num(r["end"]),
                    "tip": pc.feedback_for(r["phone"], r["heard"]) if flagged else None,
                })
                k += 1
        vowels = []
        for r, ph in zip(rows, phones):
            if r["phone"] in pc.MONOPHTHONGS and np.isfinite(r["zF1"]):
                ref = (self.norms or {}).get("vowels", {}).get(r["phone"], {})
                vowels.append({"phone": r["phone"], "word": ph["word"], "F1": _num(r["F1"]), "F2": _num(r["F2"]),
                               "zF1": _num(r["zF1"]), "zF2": _num(r["zF2"]),
                               "ref_zF1": _num(ref.get("zF1")), "ref_zF2": _num(ref.get("zF2")),
                               "ok": ph["ok"]})
        word_scores = []
        for wi, w in enumerate(words):
            ps = [p for p in phones if p["word_index"] == wi]
            word_scores.append({"word": w, "score": round(float(np.mean([p["score"] for p in ps])), 1),
                                "ok": all(p["ok"] for p in ps)})
        tips = []
        for p in phones:
            if p["tip"] and p["tip"] not in tips:
                tips.append(p["tip"])
        return {"text": text, "overall": round(float(np.mean(scores)) * 50, 1),
                "words": word_scores, "phones": phones, "vowels": vowels, "tips": tips,
                "recognised": " ".join(recognised), "expected": " ".join(canon)}


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, 3) if np.isfinite(v) else None


# =============================================================================
# Audio decoding (browser uploads are often WebM/Opus)
# =============================================================================
def decode_audio(data, filename="audio"):
    import soundfile as sf
    import io
    try:
        wav, sr = sf.read(io.BytesIO(data), dtype="float32")
    except Exception:
        suffix = os.path.splitext(filename)[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data); path = f.name
        try:
            out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR),
                                  "-f", "wav", "pipe:1"], capture_output=True, check=True).stdout
        finally:
            os.unlink(path)
        wav, sr = sf.read(io.BytesIO(out), dtype="float32")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != SR:
        import librosa
        wav = librosa.resample(wav, orig_sr=sr, target_sr=SR)
    return wav


# =============================================================================
# Visuals
# =============================================================================
def render_html(res):
    if "error" in res:
        return f"<div style='color:#d1495b;font-weight:600'>{res['error']}</div>"
    css = ("<style>.pl-w{display:inline-block;margin:6px 10px 6px 0;text-align:center;vertical-align:top}"
           ".pl-word{font-size:20px;font-weight:600;padding:2px 6px;border-radius:6px}"
           ".pl-ph{font-family:monospace;font-size:14px;margin-top:4px}"
           ".pl-ph span{padding:1px 3px;border-radius:4px;margin:0 1px}"
           ".ok{background:#e6f6ef;color:#0b6e4f}.bad{background:#fde8ea;color:#b3243a}"
           ".acc{background:#fff4dc;color:#8a5a00}</style>")
    score = res["overall"]
    color = "#0b6e4f" if score >= 80 else "#8a5a00" if score >= 60 else "#b3243a"
    html = [css, f"<div style='font-size:28px;font-weight:700;color:{color}'>Score: {score:.0f}/100</div>"]
    html.append("<div style='margin:8px 0;font-size:13px;color:#666'>"
                "<span class='ok' style='padding:1px 6px;border-radius:4px'>correct</span> "
                "<span class='acc' style='padding:1px 6px;border-radius:4px'>Indian-English variant (accepted)</span> "
                "<span class='bad' style='padding:1px 6px;border-radius:4px'>needs work</span></div><div>")
    for wi, w in enumerate(res["words"]):
        ps = [p for p in res["phones"] if p["word_index"] == wi]
        cls = "ok" if w["ok"] else "bad"
        spans = []
        for p in ps:
            c = "bad" if not p["ok"] else "acc" if p["accent_variant"] else "ok"
            label = p["expected"] if p["ok"] and not p["accent_variant"] else f"{p['expected']}→{p['heard']}"
            spans.append(f"<span class='{c}' title='score {p['score']:.0f}'>{label}</span>")
        html.append(f"<div class='pl-w'><div class='pl-word {cls}'>{w['word']}</div>"
                    f"<div class='pl-ph'>{''.join(spans)}</div></div>")
    html.append("</div>")
    if res["tips"]:
        html.append("<h4 style='margin-top:14px'>How to improve</h4><ul>")
        html += [f"<li>{t}</li>" for t in res["tips"]]
        html.append("</ul>")
    else:
        html.append("<p style='margin-top:12px'>🎉 No pronunciation problems detected.</p>")
    html.append(f"<details style='margin-top:10px;color:#555'><summary>Phone sequences</summary>"
                f"<div style='font-family:monospace'>expected: {res['expected']}<br>heard: {res['recognised']}</div></details>")
    return "".join(html)


def vowel_chart(res, norms=None):
    # Object-oriented Matplotlib (no pyplot): backend-independent and safe in server threads.
    from matplotlib.figure import Figure
    from matplotlib.patches import Ellipse
    fig = Figure(figsize=(5.5, 4.6))
    ax = fig.subplots()
    if norms:
        for v, n in norms.get("vowels", {}).items():
            ax.add_patch(Ellipse((n["zF2"], n["zF1"]), 2 * n["zF2_sd"], 2 * n["zF1_sd"],
                                 color="#8d99ae", alpha=0.18))
            ax.text(n["zF2"], n["zF1"], v, color="#5c677d", ha="center", va="center", fontsize=12)
    for t in (res or {}).get("vowels", []):
        c = "#0b6e4f" if t["ok"] else "#d1495b"
        ax.scatter(t["zF2"], t["zF1"], color=c, s=55, zorder=3, edgecolor="white")
        ax.annotate(f"{t['phone']} ({t['word']})", (t["zF2"], t["zF1"]), textcoords="offset points",
                    xytext=(5, 5), fontsize=8, color=c)
    ax.set_xlim(2.6, -2.6); ax.set_ylim(2.6, -2.6)
    ax.set_xlabel("F2 (z)  ←  front · back  →"); ax.set_ylabel("F1 (z)  ←  high · low  →")
    ax.set_title("Your vowels vs fluent Indian-English speakers (grey)", fontsize=10)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return fig


# =============================================================================
# Gradio UI
# =============================================================================
def build_gradio(engine):
    import gradio as gr

    def run(prompt, custom, audio):
        text = (custom or "").strip() or prompt
        if audio is None:
            return "<b>Record or upload audio first.</b>", None, None
        sr, wav = audio
        wav = np.asarray(wav, dtype=np.float32)
        if np.issubdtype(np.asarray(audio[1]).dtype, np.integer):
            wav = wav / 32768.0
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        if sr != SR:
            import librosa
            wav = librosa.resample(wav, orig_sr=sr, target_sr=SR)
        res = engine.analyze(wav, text)
        if "error" in res:
            return render_html(res), None, res
        return render_html(res), vowel_chart(res, engine.norms), res

    with gr.Blocks() as demo:
        gr.Markdown("# 🗣️ PhonoLens\n**Pronunciation feedback for Indian English speakers.** "
                    "Pick a sentence (or type your own), record yourself reading it, and click *Analyse*.")
        with gr.Row():
            with gr.Column(scale=1):
                prompt = gr.Dropdown(PROMPTS, value=PROMPTS[0], label="Practice sentence")
                custom = gr.Textbox(label="…or type your own sentence", placeholder="optional")
                audio = gr.Audio(sources=["microphone", "upload"], type="numpy", label="Your recording")
                btn = gr.Button("Analyse", variant="primary")
            with gr.Column(scale=2):
                out_html = gr.HTML()
                out_plot = gr.Plot(label="Vowel chart")
        with gr.Accordion("Raw JSON (same as the API response)", open=False):
            out_json = gr.JSON()
        btn.click(run, [prompt, custom, audio], [out_html, out_plot, out_json])
    return demo


# =============================================================================
# FastAPI backend (backup / for a React frontend later)
# =============================================================================
def build_api(engine):
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(title="PhonoLens API", version="1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/health")
    def health():
        return {"status": "ok", "device": engine.device, "scorer": engine.scorer is not None,
                "norms": engine.norms is not None}

    @app.get("/prompts")
    def prompts():
        return {"prompts": PROMPTS}

    @app.post("/analyze")
    async def analyze(audio: UploadFile = File(...), text: str = Form(...)):
        data = await audio.read()
        try:
            wav = decode_audio(data, audio.filename or "audio")
        except Exception as e:
            raise HTTPException(400, f"Could not decode audio: {e}")
        res = engine.analyze(wav, text)
        if "error" in res:
            raise HTTPException(422, res["error"])
        return res

    return app