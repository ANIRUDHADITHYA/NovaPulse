"""
model/train.py — XGBoost model training with SMOTE oversampling
"""

import joblib
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.metrics import classification_report, f1_score
from sklearn.preprocessing import StandardScaler
from imblearn.over_sampling import SMOTE
from xgboost import XGBClassifier
import sys
import shutil
from datetime import datetime

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_DIR = Path(__file__).parent
FEATURE_COLS = [
    "ema_cross_9_21", "ema_cross_21_50", "rsi_14", "macd_histogram",
    "bb_squeeze", "volume_ratio", "oi_change_pct_15m", "oi_change_pct_1h",
    "funding_rate", "long_short_ratio", "fear_greed_value",
    "taapi_rsi", "taapi_macd_signal",
    "hour_of_day", "day_of_week", "is_weekend",
]

TARGET_PRECISION = 0.65
TARGET_RECALL = 0.55
TARGET_F1 = 0.60


def train():
    df = pd.read_csv(DATA_DIR / "features.csv")
    X = df[FEATURE_COLS].replace([np.inf, -np.inf], np.nan).fillna(0)
    y = df["label"]

    print(f"Dataset: {len(df)} rows | Label balance: {y.mean():.2%}")

    # Train/test split (last 20% as test, time-ordered)
    split = int(len(df) * 0.8)
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]

    # SMOTE oversampling
    print("Applying SMOTE...")
    smote = SMOTE(random_state=42)
    X_resampled, y_resampled = smote.fit_resample(X_train, y_train)
    print(f"After SMOTE: {len(X_resampled)} rows")

    # XGBoost model
    model = XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )

    # 5-fold cross-validation
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X_resampled, y_resampled, cv=cv, scoring="f1")
    print(f"CV F1 scores: {cv_scores}")
    print(f"Mean CV F1: {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})")

    # Final training
    model.fit(X_resampled, y_resampled)
    y_pred = model.predict(X_test)
    report = classification_report(y_test, y_pred, output_dict=True)
    f1 = f1_score(y_test, y_pred)

    print("\nTest set report:")
    print(classification_report(y_test, y_pred))
    print(f"Final F1: {f1:.4f}")

    # Check targets
    precision = report["1"]["precision"]
    recall = report["1"]["recall"]
    passed = True
    if precision < TARGET_PRECISION:
        print(f"WARNING: Precision {precision:.4f} below target {TARGET_PRECISION}")
        passed = False
    if recall < TARGET_RECALL:
        print(f"WARNING: Recall {recall:.4f} below target {TARGET_RECALL}")
        passed = False
    if f1 < TARGET_F1:
        print(f"WARNING: F1 {f1:.4f} below target {TARGET_F1}")
        passed = False

    # Version backup of old model
    model_path = MODEL_DIR / "novapulse_model.pkl"
    if model_path.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = MODEL_DIR / f"novapulse_model_v{ts}.pkl"
        shutil.copy(model_path, backup_path)
        print(f"Old model backed up: {backup_path.name}")

        # Check if new model is better
        old_model = joblib.load(model_path)
        old_pred = old_model.predict(X_test)
        old_f1 = f1_score(y_test, old_pred)
        if f1 < old_f1:
            print(f"New model F1 ({f1:.4f}) < old model F1 ({old_f1:.4f}). Restoring old model.")
            # Restore
            shutil.copy(backup_path, model_path)
            # Clean up backup if not keeping
            return {"f1": old_f1, "degraded": True, "old_f1": old_f1, "new_f1": f1}

        # Clean up old backups (keep only 2)
        backups = sorted(MODEL_DIR.glob("novapulse_model_v*.pkl"))
        for b in backups[:-2]:
            b.unlink()

    # Save new model
    joblib.dump(model, model_path)
    print(f"Model saved: {model_path}")

    # Top 5 feature importance
    importance = sorted(
        zip(FEATURE_COLS, model.feature_importances_),
        key=lambda x: x[1], reverse=True
    )[:5]
    top_features = {feat: round(float(score), 4) for feat, score in importance}

    return {"f1": f1, "precision": precision, "recall": recall, "passed": passed, "degraded": False, "top_features": top_features}


if __name__ == "__main__":
    result = train()
    print(f"\nTraining complete: {result}")
    if not result.get("passed", True):
        print("WARNING: Model did not meet performance targets. Review before deploying.")
        sys.exit(1)
