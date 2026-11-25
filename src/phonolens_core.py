"""
phonolens_core.py — shared code for the PhonoLens project.

Sections
  1. Phone set (CMU-39 written in IPA) + normalisation of any IPA / ARPAbet input
  2. Alignment (Levenshtein) + mispronunciation detection & diagnosis (MDD) metrics
  3. CTC helpers: greedy decoding, Viterbi forced alignment
  4. Classical speech processing: pre-emphasis, framing, VAD, LPC (Levinson-Durbin), formants
  5. Feedback text for common Indian-English substitutions
"""
from collections import Counter
import numpy as np

# =============================================================================
# 1. PHONE SET
# =============================================================================
# CMU ARPAbet 39-phone set (the one L2-ARCTIC and speechocean762 are labelled in),
# written in IPA so it matches the L2-ARCTIC 'ipa' / 'g2p' columns.
ARPA2IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ",
    "ER": "ɝ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ",
    "UW": "u", "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ",
    "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ",
    "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v",
    "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
PHONES = sorted(set(ARPA2IPA.values()))                     # 39 phones
PH2ID = {p: i + 1 for i, p in enumerate(PHONES)}              # CTC labels: 0 = blank
ID2PH = {i: p for p, i in PH2ID.items()}
VOWELS = {"ɑ", "æ", "ʌ", "ɔ", "aʊ", "aɪ", "ɛ", "ɝ", "eɪ", "ɪ", "i", "oʊ", "ɔɪ", "ʊ", "u"}
MONOPHTHONGS = VOWELS - {"aʊ", "aɪ", "eɪ", "oʊ", "ɔɪ"}

# Marks we throw away (stress, length, tones, most diacritics, syllabicity, ties).
_STRIP = set("ˈˌːˑ̩̯̃ʰʲʷ̥̬̪̺̻͡‿.|-_ ") | {"̩", "̯", "̃", "͡", "˞"}

# Symbol rewrites applied before tokenising. Order matters (longest first).
# Several of these are deliberate accent-fairness decisions: e.g. Indian-English
# monophthongs [e:] / [o:] are mapped onto the FACE / GOAT diphthongs, and a tapped
# or trilled r is mapped onto /ɹ/, so these accent features are NOT counted as errors.
_REWRITES = [
    ("ɝɹ", "ɝ"), ("ɚɹ", "ɝ"), ("ɜɹ", "ɝ"), ("əɹ", "ɝ"),
    ("əʊ", "oʊ"), ("eə", "ɛ"), ("ɪə", "ɪ"), ("ʊə", "ʊ"), ("aɪə", "aɪ"),
    ("ɚ", "ɝ"), ("ɜ", "ɝ"), ("ə", "ʌ"), ("ɐ", "ʌ"), ("ᵻ", "ɪ"), ("ɨ", "ɪ"),
    ("ʉ", "u"), ("ɯ", "u"), ("y", "i"), ("ɒ", "ɑ"), ("ɫ", "l"), ("g", "ɡ"),
    ("ɾ", "ɹ"), ("r", "ɹ"), ("ɻ", "ɹ"), ("ʀ", "ɹ"), ("ʁ", "ɹ"),
    ("ʈ", "t"), ("ɖ", "d"), ("ɳ", "n"), ("ɭ", "l"), ("ʂ", "ʃ"), ("ɕ", "ʃ"), ("ʑ", "ʒ"),
    ("x", "k"), ("q", "k"), ("ç", "h"), ("ɦ", "h"), ("β", "v"), ("ʋ", "v"), ("ɸ", "f"),
    ("c", "k"), ("ɟ", "ɡ"), ("ɲ", "n"), ("ʎ", "l"), ("ʔ", ""),
]
# Single symbols that are only valid as part of a longer phone, or need a default.
_LONE = {"e": "eɪ", "o": "oʊ", "a": "ɑ"}

_PHONES_BY_LEN = sorted(PHONES, key=len, reverse=True)


def _clean(s):
    s = "".join(ch for ch in s if ch not in _STRIP)
    for a, b in _REWRITES:
        s = s.replace(a, b)
    return s


def ipa_to_phones(s, keep_unknown=False):
    """Split an IPA string (spaces optional) into CMU-39 phones (in IPA).

    Greedy longest-match, so 'tʃ', 'aɪ', 'oʊ' stay as one phone.
    Unknown symbols are dropped (or kept as '?' if keep_unknown=True).
    """
    s = _clean(s)
    out, i = [], 0
    while i < len(s):
        for p in _PHONES_BY_LEN:
            if s.startswith(p, i):
                out.append(p)
                i += len(p)
                break
        else:
            ch = s[i]
            if ch in _LONE:
                out.append(_LONE[ch])
            elif keep_unknown:
                out.append("?")
            i += 1
    # collapse 'ɝ ɹ' that can appear after rewrites
    res = []
    for p in out:
        if p == "ɹ" and res and res[-1] == "ɝ":
            continue
        res.append(p)
    return res


def tokens_to_phones(tokens):
    """Normalise a list of model tokens (e.g. espeak phones) to CMU-39 phones."""
    out = []
    for t in tokens:
        out.extend(ipa_to_phones(t))
    return out


def unknown_symbols(s):
    """Characters in an IPA string that ipa_to_phones() could not map (for checks)."""
    s = _clean(s)
    bad, i = [], 0
    while i < len(s):
        for p in _PHONES_BY_LEN:
            if s.startswith(p, i):
                i += len(p)
                break
        else:
            if s[i] not in _LONE:
                bad.append(s[i])
            i += 1
    return bad


_G2P = None


def text_to_phones(text):
    """English text -> canonical CMU-39 phones (via g2p_en: CMUdict + neural fallback).
    Same phone inventory as L2-ARCTIC and speechocean762, so everything is comparable."""
    global _G2P
    if _G2P is None:
        import nltk
        for r in ("averaged_perceptron_tagger_eng", "averaged_perceptron_tagger", "cmudict"):
            try:
                nltk.download(r, quiet=True)
            except Exception:
                pass
        from g2p_en import G2p
        _G2P = G2p()
    return arpabet_to_phones([t for t in _G2P(text) if t.strip()])


def arpabet_to_phones(seq):
    """['B', 'EH0', 'R'] -> ['b', 'ɛ', 'ɹ'] (stress digits removed)."""
    out = []
    for a in seq:
        a = "".join(ch for ch in a.upper() if ch.isalpha())
        if a in ARPA2IPA:
            out.append(ARPA2IPA[a])
    return out


# =============================================================================
# 2. ALIGNMENT + MDD METRICS
# =============================================================================
def align(ref, hyp):
    """Levenshtein alignment. Returns list of (ref_phone|None, hyp_phone|None)."""
    n, m = len(ref), len(hyp)
    D = np.zeros((n + 1, m + 1), dtype=np.int32)
    D[:, 0] = np.arange(n + 1)
    D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1])
            D[i, j] = min(sub, D[i - 1, j] + 1, D[i, j - 1] + 1)
    i, j, pairs = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i, j] == D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            pairs.append((ref[i - 1], hyp[j - 1])); i -= 1; j -= 1
        elif i > 0 and D[i, j] == D[i - 1, j] + 1:
            pairs.append((ref[i - 1], None)); i -= 1
        else:
            pairs.append((None, hyp[j - 1])); j -= 1
    return pairs[::-1]


def edit_distance(ref, hyp):
    return sum(1 for r, h in align(ref, hyp) if r != h)


def per(refs, hyps):
    """Phone error rate over a corpus (lists of phone lists)."""
    err = sum(edit_distance(r, h) for r, h in zip(refs, hyps))
    return err / max(1, sum(len(r) for r in refs))


def realised_per_canonical(canonical, other):
    """For each canonical phone, what was realised in `other` ('-' = deleted).
    Insertions are ignored (standard simplification in MDD evaluation)."""
    out = []
    for c, o in align(canonical, other):
        if c is not None:
            out.append(o if o is not None else "-")
    return out


# Realisations that are standard in Indian English (and other non-US varieties) but that
# US-trained annotators label as errors with the nearest CMU phone. In the
# "Indian-English-aware" evaluation these count as CORRECT, both in the ground truth
# and in the system's flags.
#   eɪ -> ɛ : FACE vowel as monophthong [eː]  ("gate" ~ [geːt])
#   oʊ -> ɔ : GOAT vowel as monophthong [oː]  ("goat" ~ [goːt])
#   ɝ  -> ʌ : NURSE vowel as schwa (+ r)      ("bird" ~ [bəɾd])
#   ɑ  -> ɔ : LOT vowel rounded, British-style ("hot" ~ [hɔt])
INDIAN_ENGLISH_ACCEPT = {("eɪ", "ɛ"), ("oʊ", "ɔ"), ("ɝ", "ʌ"), ("ɑ", "ɔ")}


def _same(can, real, accept):
    return real == can or (can, real) in accept


def mdd_counts(canonical, annotated, recognised, accept=frozenset()):
    """Hierarchical MDD evaluation (Qian et al.) for one utterance.

    truth: annotated != canonical  -> phone was mispronounced
    pred : recognised != canonical -> system flags the phone
    TA true accept, FR false reject, FA false accept, TR true reject;
    TR is split into CD (correct diagnosis) / DE (diagnosis error).
    """
    ann = realised_per_canonical(canonical, annotated)
    rec = realised_per_canonical(canonical, recognised)
    c = Counter()
    for can, a, r in zip(canonical, ann, rec):
        truth, pred = not _same(can, a, accept), not _same(can, r, accept)
        if not truth and not pred:
            c["TA"] += 1
        elif not truth and pred:
            c["FR"] += 1
        elif truth and not pred:
            c["FA"] += 1
        else:
            c["TR"] += 1
            c["CD" if r == a else "DE"] += 1
    return c


def mdd_metrics(counts):
    TR, FR, FA = counts["TR"], counts["FR"], counts["FA"]
    p = TR / max(1, TR + FR)
    r = TR / max(1, TR + FA)
    f1 = 2 * p * r / max(1e-9, p + r)
    diag = counts["CD"] / max(1, TR)
    far = FR / max(1, FR + counts["TA"])          # false-rejection rate on correct phones
    return {"precision": p, "recall": r, "f1": f1,
            "diagnosis_acc": diag, "false_rejection_rate": far}


def error_pairs(canonical, annotated):
    """Counter of (canonical -> realised) for every mispronounced phone."""
    ann = realised_per_canonical(canonical, annotated)
    return Counter((c, a) for c, a in zip(canonical, ann) if c != a)


# =============================================================================
# 3. CTC HELPERS
# =============================================================================
def ctc_greedy(ids, blank=0):
    """Collapse repeats, drop blanks. `ids` = argmax over the vocab per frame."""
    out, prev = [], None
    for i in ids:
        i = int(i)
        if i != prev and i != blank:
            out.append(i)
        prev = i
    return out


def ctc_forced_align(log_probs, targets, blank=0):
    """Viterbi CTC forced alignment.

    log_probs: (T, V) log-softmax output; targets: list of label ids (no blanks).
    Returns a list of (first_frame, last_frame) per target token, where a token
    also owns the blank frames that follow it (useful for measuring segments).
    Returns None if the utterance is too short for the target sequence.
    """
    lp = np.asarray(log_probs, dtype=np.float64)
    T = lp.shape[0]
    L = len(targets)
    if L == 0:
        return []
    z = [blank]
    for t in targets:
        z += [t, blank]
    S = len(z)
    z = np.array(z)
    NEG = -1e30
    alpha = np.full((T, S), NEG)
    back = np.zeros((T, S), dtype=np.int8)       # 0 stay, 1 from s-1, 2 from s-2
    alpha[0, 0] = lp[0, z[0]]
    alpha[0, 1] = lp[0, z[1]]
    skip_ok = np.zeros(S, dtype=bool)
    skip_ok[2:] = (z[2:] != blank) & (z[2:] != z[:-2])
    for t in range(1, T):
        a0 = alpha[t - 1]
        a1 = np.concatenate([[NEG], a0[:-1]])
        a2 = np.concatenate([[NEG, NEG], a0[:-2]])
        a2 = np.where(skip_ok, a2, NEG)
        stack = np.stack([a0, a1, a2])
        back[t] = np.argmax(stack, axis=0)
        alpha[t] = stack.max(axis=0) + lp[t, z]
    end = S - 1 if alpha[T - 1, S - 1] >= alpha[T - 1, S - 2] else S - 2
    if alpha[T - 1, end] <= NEG / 2:
        return None
    states = np.zeros(T, dtype=np.int64)
    s = end
    for t in range(T - 1, -1, -1):
        states[t] = s
        s -= int(back[t, s])
    starts = [None] * L
    for t, s in enumerate(states):
        if s % 2 == 1:
            k = s // 2
            if starts[k] is None:
                starts[k] = t
    if any(x is None for x in starts):
        return None
    spans = []
    for k in range(L):
        last = (starts[k + 1] - 1) if k + 1 < L else T - 1
        spans.append((starts[k], max(starts[k], last)))
    return spans


def collapse_vocab(vocab, blank_token="<pad>"):
    """Map a model's token vocabulary onto the 39 phones.

    Returns (groups, blank_id): groups[k] = list of vocab ids whose token
    normalises to exactly PHONES[k]. Used to turn a big multilingual phoneme
    model's output into a 39-phone posteriorgram (log-sum-exp per group).
    """
    groups = [[] for _ in PHONES]
    idx = {p: k for k, p in enumerate(PHONES)}
    for tok, i in vocab.items():
        ph = ipa_to_phones(tok)
        if len(ph) == 1 and ph[0] in idx:
            groups[idx[ph[0]]].append(i)
    return groups, vocab[blank_token]


def collapse_log_probs(log_probs, groups, blank_id):
    """(T, V) -> (T, 40) log-probs: column 0 = blank, column k+1 = PHONES[k]."""
    from scipy.special import logsumexp
    lp = np.asarray(log_probs, dtype=np.float64)
    cols = [lp[:, blank_id]]
    for g in groups:
        cols.append(logsumexp(lp[:, g], axis=1) if g else np.full(lp.shape[0], -1e30))
    out = np.stack(cols, axis=1)
    return out - logsumexp(out, axis=1, keepdims=True)   # renormalise


# =============================================================================
# 4. CLASSICAL SPEECH PROCESSING
# =============================================================================
def pre_emphasis(x, coef=0.97):
    """y[n] = x[n] - a x[n-1]: flattens the -6 dB/octave glottal/lip spectral tilt."""
    x = np.asarray(x, dtype=np.float64)
    return np.append(x[0], x[1:] - coef * x[:-1])


def frame_signal(x, sr, win_ms=25.0, hop_ms=10.0):
    win, hop = int(round(sr * win_ms / 1000)), int(round(sr * hop_ms / 1000))
    if len(x) < win:
        x = np.pad(x, (0, win - len(x)))
    n = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    return x[idx], hop


def energy_zcr_vad(x, sr, win_ms=25.0, hop_ms=10.0, floor_db=-35.0, zcr_max=0.25):
    """Classical VAD: frame is speech if short-time energy is within `floor_db`
    of the loudest frame and the zero-crossing rate is not noise-like.
    Returns (is_speech[bool per frame], energy_db, zcr, hop)."""
    frames, hop = frame_signal(np.asarray(x, dtype=np.float64), sr, win_ms, hop_ms)
    e = 10 * np.log10(np.mean(frames ** 2, axis=1) + 1e-12)
    zcr = np.mean(np.abs(np.diff(np.sign(frames), axis=1)) > 0, axis=1)
    # High ZCR + low energy = background noise; high ZCR + decent energy = a fricative
    # like /s/ or /ʃ/, which IS speech and must be kept.
    speech = (e > e.max() + floor_db) & ~((zcr >= zcr_max) & (e < e.max() - 20.0))
    # hangover smoothing: fill gaps shorter than 50 ms
    gap = int(50 / hop_ms)
    s = speech.copy()
    i = 0
    while i < len(s):
        if not s[i]:
            j = i
            while j < len(s) and not s[j]:
                j += 1
            if 0 < i and j < len(s) and (j - i) <= gap:
                s[i:j] = True
            i = j
        else:
            i += 1
    return s, e, zcr, hop


def levinson_durbin(r, order):
    """Solve the LPC normal equations from autocorrelation r[0..order].
    Returns (a, err) with a[0] = 1 so that A(z) = sum a_k z^-k."""
    a = np.zeros(order + 1)
    a[0] = 1.0
    err = r[0]
    if err <= 0:
        return a, 0.0
    for i in range(1, order + 1):
        acc = r[i] + np.dot(a[1:i], r[i - 1:0:-1])
        k = -acc / err
        a_prev = a.copy()
        a[1:i] = a_prev[1:i] + k * a_prev[i - 1:0:-1]
        a[i] = k
        err *= (1 - k * k)
        if err <= 0:
            break
    return a, err


def lpc(frame, order):
    """Autocorrelation-method LPC of one (already windowed) frame."""
    r = np.correlate(frame, frame, mode="full")[len(frame) - 1:len(frame) + order]
    r[0] *= 1.0 + 1e-9                                     # tiny white-noise floor
    return levinson_durbin(r, order)[0]


def formants_from_lpc(a, sr, n=3, fmin=90.0, bw_max=400.0):
    """Roots of A(z) -> resonance frequencies/bandwidths; keep the first n."""
    roots = np.roots(a)
    roots = roots[np.imag(roots) > 0]
    f = np.angle(roots) * sr / (2 * np.pi)
    bw = -np.log(np.abs(roots) + 1e-12) * sr / np.pi
    keep = (f > fmin) & (bw < bw_max)
    f, bw = f[keep], bw[keep]
    o = np.argsort(f)
    f, bw = f[o], bw[o]
    out_f = np.full(n, np.nan)
    out_b = np.full(n, np.nan)
    out_f[:min(n, len(f))] = f[:n]
    out_b[:min(n, len(bw))] = bw[:n]
    return out_f, out_b


def formant_ceiling(f0_median):
    """Pitch-adaptive analysis ceiling (Praat convention): higher voices have
    shorter vocal tracts, so their formants sit higher."""
    if f0_median is None or not np.isfinite(f0_median):
        return 5500.0
    if f0_median < 165:
        return 5000.0       # typical adult male
    if f0_median < 250:
        return 5500.0       # typical adult female
    return 6500.0           # children / very high voices


def track_formants(x, sr, f0_median=None, win_ms=25.0, hop_ms=10.0,
                   n_formants=3, preemph=0.97, bw_max=400.0, smooth=0):
    """Frame-by-frame F1..Fn with our own LPC.

    Steps: pitch-adaptive ceiling -> resample to 2*ceiling -> pre-emphasis ->
    25 ms Hamming frames -> autocorrelation LPC (order 2*5+2) -> polynomial roots.
    Returns (times[s], F[frames, n], BW[frames, n]).
    """
    import scipy.signal as sps
    from math import gcd
    ceiling = formant_ceiling(f0_median)
    sr2 = int(2 * ceiling)
    g = gcd(sr, sr2)
    y = sps.resample_poly(np.asarray(x, dtype=np.float64), sr2 // g, sr // g)
    y = pre_emphasis(y, preemph)
    frames, hop = frame_signal(y, sr2, win_ms, hop_ms)
    w = np.hamming(frames.shape[1])
    order = 12                                   # 5 formants * 2 + 2
    F = np.full((len(frames), n_formants), np.nan)
    B = np.full((len(frames), n_formants), np.nan)
    for i, fr in enumerate(frames):
        fr = fr * w
        if np.sum(fr ** 2) < 1e-10:
            continue
        F[i], B[i] = formants_from_lpc(lpc(fr, order), sr2, n_formants, bw_max=bw_max)
    if smooth and smooth > 1:
        F = _nan_median_filter(F, smooth)
    times = (np.arange(len(frames)) * hop + frames.shape[1] / 2) / sr2
    return times, F, B


def _nan_median_filter(F, k):
    """Running median (window k frames) per formant track, ignoring NaNs.
    Removes isolated jumps where one frame's formant numbering slips."""
    out = F.copy()
    h = k // 2
    for i in range(len(F)):
        w = F[max(0, i - h): i + h + 1]
        if np.isfinite(F[i]).any():
            with np.errstate(all="ignore"):
                out[i] = np.where(np.isfinite(F[i]), np.nanmedian(w, axis=0), np.nan)
    return out


def pitch_track(x, sr, fmin=60.0, fmax=450.0, hop_ms=10.0):
    """F0 with pYIN (probabilistic YIN). Returns (times, f0 [nan=unvoiced], voiced)."""
    import librosa
    hop = int(sr * hop_ms / 1000)
    frame_length = 2 ** int(np.ceil(np.log2(sr * 0.064)))      # ~64 ms (1024 @ 16 kHz)
    f0, voiced, _ = librosa.pyin(np.asarray(x, dtype=np.float32), fmin=fmin, fmax=fmax,
                                 sr=sr, frame_length=frame_length, hop_length=hop)
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    return times, f0, voiced


def segment_formants(times, F, t0, t1, mid_fraction=0.5):
    """Median F1..Fn over the middle part of a segment [t0, t1] (seconds)."""
    pad = (t1 - t0) * (1 - mid_fraction) / 2
    m = (times >= t0 + pad) & (times <= t1 - pad)
    if not m.any():
        m = (times >= t0) & (times <= t1)
    if not m.any():
        return np.full(F.shape[1], np.nan)
    return np.nanmedian(F[m], axis=0)


def lobanov(values):
    """z-score normalisation of formants within one speaker/utterance
    (removes vocal-tract-length differences so speakers can be compared)."""
    v = np.asarray(values, dtype=float)
    mu, sd = np.nanmean(v, axis=0), np.nanstd(v, axis=0)
    return (v - mu) / np.where(sd > 0, sd, 1)


# =============================================================================
# 5. FEEDBACK TEXT
# =============================================================================
# Articulation tips keyed by (expected, produced). '-' = sound was dropped.
FEEDBACK = {
    ("v", "w"): "For /v/ (as in 'vest'), touch your upper teeth to your lower lip and let it buzz. Don't round your lips like /w/.",
    ("w", "v"): "For /w/ (as in 'west'), round your lips without touching your teeth, then glide into the vowel.",
    ("θ", "t"): "For 'th' in 'thin', put your tongue tip lightly between your teeth and blow air; don't stop the air like /t/.",
    ("θ", "s"): "For 'th' in 'thin', put your tongue between your teeth, not behind them as for /s/.",
    ("ð", "d"): "For 'th' in 'this', put your tongue between your teeth and keep your voice buzzing; don't make a full stop like /d/.",
    ("ð", "z"): "For 'th' in 'this', move your tongue forward between your teeth.",
    ("z", "dʒ"): "For /z/ (as in 'zero'), keep a steady buzzing hiss; don't start with a stop like 'j'.",
    ("z", "s"): "For /z/ at the end of words like 'bags', keep your voice on: it should buzz, not hiss.",
    ("ʒ", "z"): "For the sound in 'measure', pull your tongue back a little and round your lips slightly (like 'sh' with voice).",
    ("ʒ", "dʒ"): "For the sound in 'measure', don't start with a stop; it's a smooth buzz, like 'sh' with voice.",
    ("ʃ", "s"): "For 'sh', pull your tongue back and round your lips a little.",
    ("f", "p"): "For /f/, let air flow between your upper teeth and lower lip instead of closing your lips.",
    ("æ", "ɛ"): "For the vowel in 'bad', open your jaw wider and spread your lips; it's lower than the vowel in 'bed'.",
    ("ɛ", "æ"): "For the vowel in 'bed', close your jaw a little more than for 'bad'.",
    ("i", "ɪ"): "For the vowel in 'sheep', make it longer and tenser, with lips spread.",
    ("ɪ", "i"): "For the vowel in 'ship', keep it short and relaxed.",
    ("u", "ʊ"): "For the vowel in 'food', make it longer with rounded lips.",
    ("ʊ", "u"): "For the vowel in 'book', keep it short and relaxed.",
    ("ʌ", "ɑ"): "For the vowel in 'cup', keep it short and central; don't open as wide as in 'father'.",
    ("ɔ", "ɑ"): "For the vowel in 'thought', round your lips a little more.",
    ("ɝ", "ʌ"): "For the vowel in 'bird', curl your tongue slightly back and keep the 'r' colour.",
}


def feedback_for(expected, produced):
    if (expected, produced) in FEEDBACK:
        return FEEDBACK[(expected, produced)]
    if produced == "-":
        return f"The sound /{expected}/ was dropped. Make sure you say it."
    if expected == "-":
        return f"An extra sound /{produced}/ was added."
    return f"Expected /{expected}/ but heard /{produced}/."