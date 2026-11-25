"""PhonoLens backend: FastAPI (+ optional Gradio UI at /ui).

    python server.py            # API on http://localhost:8000  (docs at /docs)
    python server.py --ui       # API + Gradio UI at http://localhost:8000/ui
"""
import argparse, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from phonolens_app import Engine, build_api, build_gradio

MODEL_DIR = os.environ.get("PHONOLENS_MODEL", os.path.join(HERE, "phonolens-ft"))
ASSETS_DIR = os.environ.get("PHONOLENS_ASSETS", os.path.join(HERE, "phonolens-app"))
engine = Engine(MODEL_DIR, ASSETS_DIR)
app = build_api(engine)

if __name__ == "__main__":
    import uvicorn
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui", action="store_true", help="also serve the Gradio UI at /ui")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    if args.ui:
        import gradio as gr
        app = gr.mount_gradio_app(app, build_gradio(engine), path="/ui")
    print(f"PhonoLens running on http://localhost:{args.port}  (device: {engine.device})")
    uvicorn.run(app, host="0.0.0.0", port=args.port)
