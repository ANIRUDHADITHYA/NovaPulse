"""
model/evaluate.py — Model evaluation and feature importance analysis
"""

import joblib
import pandas as pd
import numpy as np
import json
from pathlib import Path
from sklearn.metrics import classification_report, confusion_matrix, f1_score

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_DIR = Path(__file__).parent

FEATURE_COLS = [
    "ema_cross_9_21", "ema_cross_21_50", "rsi_14", "macd_histogram",
    "bb_squeeze", "volume_ratio", "oi_change_pct_15m", "oi_change_pct_1h",
    "funding_rate", "long_short_ratio", "fear_greed_value",
    "taapi_rsi", "taapi_macd_signal",
    "hour_of_day", "day_of_week", "is_weekend",
]


def evaluate():
    model_path = MODEL_DIR / "novapulse_model.pkl"
    if not model_path.exists():
        print("No model found. Run train.py first.")
        return

    model = joblib.load(model_path)
    df = pd.read_csv(DATA_DIR / "features.csv")
    X = df[FEATURE_COLS].replace([np.inf, -np.inf], np.nan).fillna(0)
    y = df["label"]

    # Use last 20% as test
    split = int(len(df) * 0.8)
    X_test = X.iloc[split:]
    y_test = y.iloc[split:]

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    print("=== Confusion Matrix ===")
    print(confusion_matrix(y_test, y_pred))

    print("\n=== Classification Report ===")
    print(classification_report(y_test, y_pred))

    print(f"F1 Score: {f1_score(y_test, y_pred):.4f}")

    print("\n=== Feature Importance ===")
    importance = pd.Series(model.feature_importances_, index=FEATURE_COLS)
    importance = importance.sort_values(ascending=False)
    for feat, score in importance.items():
        print(f"  {feat:<30} {score:.4f}")

    return {"f1": f1_score(y_test, y_pred), "feature_importance": importance.to_dict()}


if __name__ == "__main__":
    evaluate()
