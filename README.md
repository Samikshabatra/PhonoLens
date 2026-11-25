<div align="center">

# PhonoLens

**Hear what you actually said. Mispronunciation detection and articulatory feedback for Indian English speakers.**

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?logo=pytorch&logoColor=white)
![Transformers](https://img.shields.io/badge/Hugging%20Face-wav2vec2-FFD21E?logo=huggingface&logoColor=black)
![librosa](https://img.shields.io/badge/librosa-DSP-4B8BBE)
![Praat](https://img.shields.io/badge/Praat-parselmouth-6A5ACD)
![scikit-learn](https://img.shields.io/badge/scikit--learn-F7931E?logo=scikitlearn&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Gradio](https://img.shields.io/badge/Gradio-F97316?logo=gradio&logoColor=white)
![Colab](https://img.shields.io/badge/Run%20on-Colab%20T4-F9AB00?logo=googlecolab&logoColor=black)

</div>

A pronunciation coach for English learners whose first language is Indian. You read a sentence out loud, and PhonoLens tells you which sounds came out differently from what was expected, what it heard instead, and how to move your mouth to fix it. Every phone gets a score, every word gets a colour, and your vowels land on a chart next to where fluent Indian English speakers put theirs.

Most pronunciation tools quietly assume the goal is an American accent. That's the part I wanted to get right. An Indian speaker saying "face" with a pure /e/ instead of the American /eɪ/ isn't making a mistake, it's a standard Indian English realisation. So PhonoLens has two rules: a **strict** one that flags any difference from the dictionary, and an **Indian-English-aware** one that only flags a sound if it's genuinely off compared to what fluent Indian speakers produce. Then it checks whether that second rule actually judges speakers of 19 different Indian first languages more fairly. (Honest answer: it flags far less overall, but not more evenly. More on that below.)

Built for MAI522 Speech and Pattern Recognition (CIA-III, Team 23).

## What it does

- **Recognises what was actually said, phone by phone.** A wav2vec2 XLSR-53 phoneme recogniser, fine-tuned on non-native English to output a 39-phone set, decodes the audio into the sounds the speaker really produced rather than the ones they were meant to.
- **Finds and diagnoses mispronunciations.** The recognised phones are aligned against the canonical pronunciation (Levenshtein), so each error is reported as "expected /ʌ/, heard /ɪ/" rather than a vague "try again".
- **Scores every phone** with CTC likelihood-ratio GOP (goodness of pronunciation) features fed into a gradient-boosted regressor trained on speechocean762's expert phone scores.
- **Measures your vowels with classical DSP.** Pre-emphasis, energy and zero-crossing VAD, pYIN pitch, and a pitch-adaptive LPC formant tracker written from scratch and validated against Praat. Vowels are placed on an F1/F2 chart after Lobanov normalisation.
- **Compares you to Indian English, not American English.** Vowel targets, phone durations, and per-phone GOP thresholds come from fluent Indian English speech (IndicTTS, 13 first languages).
- **Gives articulatory tips** for each flagged sound: where the tongue goes, whether the lips round, how long to hold it.
- **Runs as an app.** A Gradio UI (record or upload) and a FastAPI backend with a single `POST /analyze` endpoint, ready for a React frontend.

## How it works

```
                 audio + target sentence
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
   ┌─────────────────┐          ┌──────────────────┐
   │ wav2vec2 (fine- │          │ classical DSP    │
   │ tuned, 39 phones│          │ pre-emphasis,    │
   │ + CTC blank)    │          │ VAD, pYIN, LPC   │
   └────────┬────────┘          └────────┬─────────┘
            │ log-probs                  │ F1/F2, F0, duration
            ▼                            │
   CTC forced alignment ─── phone spans ─┤
   + GOP features                        │
            │                            │
            └────────────┬───────────────┘
                         ▼
              ┌─────────────────────┐
              │ GBM phone scorer    │   trained on speechocean762
              └──────────┬──────────┘   expert scores
                         ▼
              ┌─────────────────────┐
              │ Rule A: strict      │
              │ Rule B: Indian-     │   IndicTTS norms + p10
              │ English-aware       │   GOP thresholds
              └──────────┬──────────┘
                         ▼
         per-phone flags, scores, tips, vowel chart
```

A few design choices that mattered:

- **Train on what was said, not what should have been said.** The recogniser's targets are the expert *annotated* pronunciations from L2-ARCTIC. Training on dictionary pronunciations would teach the model to "hear" every error as correct, which defeats the point.
- **Warm-started output head.** The new 40-class head (blank + 39 phones) is initialised from the pretrained model's matching espeak phone rows, so fine-tuning starts from the baseline instead of from random.
- **Speaker-independent splits.** Train on 15 L2-ARCTIC speakers (plus adult speechocean762 utterances rated fully correct), select on 5 dev speakers from other L1s, and test on the 4 Hindi-L1 speakers, who are never seen in training.

## Results

All numbers are on the **4 unseen Hindi-L1 speakers** (600 utterances) unless noted.

**Phone recognition and mispronunciation detection** (strict labels)

| Model | PER | Precision | Recall | F1 | False rejection | Diagnosis acc. |
|---|---|---|---|---|---|---|
| Pretrained wav2vec2 (no fine-tuning) | 0.231 | 0.364 | 0.492 | 0.419 | 0.137 | 0.628 |
| **PhonoLens fine-tuned** | **0.155** | **0.527** | **0.501** | **0.514** | **0.072** | **0.763** |

Fine-tuning cut phone error rate by a third and halved the number of correct sounds wrongly flagged as errors. Best checkpoint was epoch 9 of 12 by dev F1.

**Phone scorer** (speechocean762 test set, Pearson correlation with expert scores)

| Features | Test PCC | AUC (incorrect phones) |
|---|---|---|
| GOP only (linear) | 0.543 | 0.922 |
| Model features (GBM) | 0.677 | 0.948 |
| Model + classical formant features | 0.678 | 0.948 |

The classical vowel features barely move the needle once the model's own posteriors are in. Worth knowing.

**Rule A vs Rule B** (strict labels)

| Rule | Precision | Recall | F1 | False rejection | Flag rate |
|---|---|---|---|---|---|
| A: strict | 0.527 | 0.501 | 0.514 | 0.072 | 13.1% |
| B: Indian-English-aware (p10) | 0.506 | 0.164 | 0.247 | 0.025 | 4.4% |

Rule B is much gentler: it wrongly flags a correct sound a third as often, at the cost of catching fewer real errors. The threshold percentile is the knob between the two.

**Accent fairness on Svarah** (19 Indian first languages, flag rate per language group)

| Rule | Mean flag rate | Max / min ratio | Coeff. of variation |
|---|---|---|---|
| A: strict | 0.228 | 1.68 | 0.148 |
| B: Indian-English-aware | 0.144 | 2.30 | 0.213 |

This is the honest result: Rule B flags far fewer phones for everyone, but the spread *between* language groups gets wider, not narrower. Lower absolute burden, not yet more even.

**Formant tracker vs Praat** (40 utterances, ~9k voiced frames): median absolute difference of 18 Hz on F1 and 46 Hz on F2, with about 72% of frames within 10%.

<p align="center">
  <img src="docs/figures/02_classical_pipeline.png" width="49%" alt="Classical pipeline: waveform, VAD, pitch and LPC formants">
  <img src="docs/figures/04_vowel_chart_hindi_l1.png" width="49%" alt="Vowel chart: Hindi-L1 speakers vs others">
</p>
<p align="center">
  <img src="docs/figures/06_baseline_vs_finetuned.png" width="49%" alt="Baseline vs fine-tuned on unseen Hindi speakers">
  <img src="docs/figures/11_svarah_fairness.png" width="49%" alt="Flag rate by first language on Svarah">
</p>

All figures are in [`docs/figures/`](docs/figures).

## Project layout

```
Phonolens/
├── notebooks/
│   ├── 01_data_classical_pipeline_baseline.ipynb   # L2-ARCTIC splits, error analysis,
│   │                                               #   DSP pipeline, LPC vs Praat,
│   │                                               #   pretrained baseline, vowel chart
│   ├── 02_finetuning_evaluation.ipynb              # fine-tune wav2vec2, baseline vs
│   │                                               #   fine-tuned on unseen Hindi speakers
│   └── 03_scoring_fairness_app.ipynb               # formant tuning, IndicTTS norms, GOP
│                                                   #   scorer, Rule A vs B, Svarah
│                                                   #   fairness, Gradio + FastAPI app
├── src/
│   ├── phonolens_core.py    # phone set, alignment, MDD metrics, DSP (VAD, pitch, LPC
│   │                        #   formants), CTC forced alignment, Lobanov normalisation
│   ├── phonolens_app.py     # inference engine, GOP features, scoring, Gradio UI, FastAPI
│   └── server.py            # run the API (and optionally the UI) on a laptop
├── docs/figures/            # plots exported from the notebooks
├── requirements.txt
└── README.md
```

The two modules in `src/` are the final versions written out by Notebook 3 (each notebook writes them to Drive with `%%writefile`, so the notebooks stay self-contained).

## Running it

### The notebooks (Colab)

Everything was built and run on Google Colab with a T4 GPU, with data and models kept in `MyDrive/phonolens_data/`.

1. Runtime → Change runtime type → **T4 GPU**.
2. Run **cell 1**. It installs packages and restarts the runtime once; that's expected.
3. Runtime → **Run all**.

Run them in order: Notebook 2 needs the splits from Notebook 1, and Notebook 3 needs the fine-tuned model from Notebook 2. Fine-tuning takes about 45 to 75 minutes and resumes from the last finished epoch if Colab disconnects.

**Datasets used:** [L2-ARCTIC](https://psi.engr.tamu.edu/l2-arctic-corpus/) (training and the Hindi test speakers), [speechocean762](https://www.openslr.org/101/) (extra training data and expert scores for the scorer), [IndicTTS](https://www.iitm.ac.in/donlab/tts/) (Indian English reference norms), and [Svarah](https://github.com/AI4Bharat/Svarah) (accent-fairness check). Starting model: [`facebook/wav2vec2-xlsr-53-espeak-cv-ft`](https://huggingface.co/facebook/wav2vec2-xlsr-53-espeak-cv-ft).

### The app on your own machine

The fine-tuned model (~1.2 GB) isn't in the repo. Section 9 of Notebook 3 packages it into `MyDrive/phonolens_data/server/`; copy the `phonolens-ft/` and `phonolens-app/` folders from there into `src/`.

You'll need Python 3.10+ and **ffmpeg** (for browser WebM audio): `winget install ffmpeg` on Windows, `brew install ffmpeg` on macOS.

```bash
pip install -r requirements.txt
cd src
python server.py --ui
```

Then open `http://localhost:8000/ui` for the app or `http://localhost:8000/docs` for the API. To keep the model somewhere else, set `PHONOLENS_MODEL` and `PHONOLENS_ASSETS`.

The saved scorer is a pickled scikit-learn model, so install the same scikit-learn version Colab used when you trained it.

## The API

**`POST /analyze`** (multipart form)

| Field | Type | Description |
|---|---|---|
| `audio` | file | any format ffmpeg can read, including browser WebM |
| `text` | string | the sentence the speaker was reading |

```bash
curl -X POST http://localhost:8000/analyze \
  -F "audio=@recording.webm" \
  -F "text=The thin vest was very warm."
```

Returns an overall score, per-word and per-phone results (`expected`, `heard`, `ok`, `score`, `start`, `end`, `tip`), measured vowel formants, and feedback tips. CORS is open, so a React dev server can call it directly.

**`GET /prompts`** returns the built-in practice sentences. **`GET /health`** returns `{ "status": "ok", "device": "cuda", "scorer": true, "norms": true }`.

## Things I'd add next

- Make Rule B fair, not just lenient: calibrate thresholds per first-language group so the flag-rate spread on Svarah shrinks instead of grows.
- Get labelled Indian English mispronunciation data. The Hindi test labels come from US annotators, so "error" still partly means "not American".
- Add prosody feedback (stress and intonation), since the pitch track is already there.
- A React frontend over the API with a live vowel chart while you speak.
- Distil the model so it runs comfortably on a laptop CPU.
