"""
app.py — Flask ML microservice for NovaPulse
Endpoints: POST /predict, POST /retrain, GET /retrain/status, GET /health
"""

import os
import threading
import traceback
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from flask import Flask, jsonify, request

FEATURE_COLS = [
    "ema_cross_9_21", "ema_cross_21_50", "rsi_14", "macd_histogram",
    "bb_squeeze", "volume_ratio", "oi_change_pct_15m", "oi_change_pct_1h",
    "funding_rate", "long_short_ratio", "fear_greed_value",
    "taapi_rsi", "taapi_macd_signal",
    "hour_of_day", "day_of_week", "is_weekend",
]

MODEL_PATH = Path(__file__).parent / "model" / "novapulse_model.pkl"

app = Flask(__name__)

# ── Model state ──────────────────────────────────────────────
model = None
model_loaded = False

retrain_status = {
    "status": "idle",  # idle | running | completed | failed
    "last_completed": None,
    "last_f1": None,
    "degraded": False,       # True if last retrain rolled back to old model
    "degraded_detail": None, # { old_f1, new_f1 } when degraded
    "top_features": None,    # { feature_name: importance } top 5 from last successful retrain
}


def load_model():
    global model, model_loaded
    if MODEL_PATH.exists():
        model = joblib.load(MODEL_PATH)
        model_loaded = True
        print(f"[NovaPulse ML] Model loaded from {MODEL_PATH}")
    else:
        model_loaded = False
        print("[NovaPulse ML] No model file found — cold start fallback active")


load_model()


# ── /predict ─────────────────────────────────────────────────
@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Empty request body"}), 400

    # Validate all 16 features exist and are numeric
    missing = []
    invalid = []
    for col in FEATURE_COLS:
        if col not in data:
            missing.append(col)
        else:
            v = data[col]
            if v is None:
                invalid.append(col)
            elif not isinstance(v, (int, float)):
                invalid.append(col)  # non-numeric type (string, list, etc.)
            elif isinstance(v, float) and np.isnan(v):
                invalid.append(col)

    if missing:
        return jsonify({"error": f"Missing features: {missing}"}), 400
    if invalid:
        return jsonify({"error": f"Null/NaN/non-numeric features: {invalid}"}), 400

    if not model_loaded or model is None:
        return jsonify({"score": 0.5, "fallback": True})

    try:
        features = [[data[col] for col in FEATURE_COLS]]
        proba = model.predict_proba(features)[0][1]
        return jsonify({"score": float(proba), "fallback": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── /retrain ─────────────────────────────────────────────────
def _run_retrain():
    global retrain_status
    retrain_status["status"] = "running"
    try:
        import subprocess
        import sys

        base = Path(__file__).parent
        subprocess.check_call([sys.executable, str(base / "data" / "collector.py")])
        subprocess.check_call([sys.executable, str(base / "data" / "features.py")])
        result_raw = subprocess.check_output(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, '.'); from model.train import train; import json; print(json.dumps(train()))"],
            cwd=str(base),
        )
        result = __import__("json").loads(result_raw.decode())

        if result.get("degraded"):
            load_model()  # reload (old model was restored)
            retrain_status["degraded"] = True
            retrain_status["degraded_detail"] = {
                "old_f1": result.get("old_f1"),
                "new_f1": result.get("new_f1"),
            }
        else:
            load_model()  # reload new model
            retrain_status["degraded"] = False
            retrain_status["degraded_detail"] = None
            retrain_status["top_features"] = result.get("top_features")

        retrain_status["status"] = "completed"
        retrain_status["last_completed"] = datetime.utcnow().isoformat()
        retrain_status["last_f1"] = result.get("f1")
    except Exception:
        retrain_status["status"] = "failed"
        traceback.print_exc()


@app.route("/retrain", methods=["POST"])
def retrain():
    if retrain_status["status"] == "running":
        return jsonify({"status": "already_running"})
    t = threading.Thread(target=_run_retrain, daemon=True)
    t.start()
    return jsonify({"status": "retraining_started"})


@app.route("/retrain/status", methods=["GET"])
def retrain_status_endpoint():
    return jsonify(retrain_status)


# ── /health ──────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model_loaded": model_loaded})


if __name__ == "__main__":
    port = int(os.environ.get("ML_PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
