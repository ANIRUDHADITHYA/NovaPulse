"""
data/features.py — Feature engineering pipeline for NovaPulse ML model
"""

import pandas as pd
import numpy as np
import ta
from pathlib import Path

DATA_DIR = Path(__file__).parent
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
LABEL_HORIZON = 4   # candles
LABEL_TARGET = 0.008  # 0.8% price move


def compute_features(ohlcv: pd.DataFrame, oi: pd.DataFrame, funding: pd.DataFrame) -> pd.DataFrame:
    df = ohlcv.copy().sort_values("timestamp").reset_index(drop=True)

    # EMA crossover features
    df["ema9"] = ta.trend.EMAIndicator(df["close"], window=9).ema_indicator()
    df["ema21"] = ta.trend.EMAIndicator(df["close"], window=21).ema_indicator()
    df["ema50"] = ta.trend.EMAIndicator(df["close"], window=50).ema_indicator()
    df["ema_cross_9_21"] = np.where(df["ema9"] > df["ema21"], 1, -1)
    df["ema_cross_21_50"] = np.where(df["ema21"] > df["ema50"], 1, -1)

    # RSI
    df["rsi_14"] = ta.momentum.RSIIndicator(df["close"], window=14).rsi()

    # MACD histogram
    macd = ta.trend.MACD(df["close"], window_fast=12, window_slow=26, window_sign=9)
    df["macd_histogram"] = macd.macd_diff()

    # Bollinger Bands squeeze
    bb = ta.volatility.BollingerBands(df["close"], window=20, window_dev=2)
    df["bb_width"] = bb.bollinger_wband()
    df["bb_squeeze"] = (df["bb_width"] < df["bb_width"].rolling(20).min() * 1.1).astype(int)

    # Volume ratio
    df["volume_ratio"] = df["volume"] / df["volume"].rolling(20).mean()

    # Merge OI (resample to 15m)
    if len(oi) > 0:
        oi_r = oi.copy().set_index("timestamp").resample("15min").last().ffill().reset_index()
        oi_r["oi_change_pct_15m"] = oi_r["oi"].pct_change(1)
        oi_r["oi_change_pct_1h"] = oi_r["oi"].pct_change(4)
        df = pd.merge_asof(
            df.sort_values("timestamp"),
            oi_r[["timestamp", "oi_change_pct_15m", "oi_change_pct_1h"]].sort_values("timestamp"),
            on="timestamp",
            direction="backward",
        )
    else:
        df["oi_change_pct_15m"] = 0.0
        df["oi_change_pct_1h"] = 0.0

    # Merge funding rate
    if len(funding) > 0:
        df = pd.merge_asof(
            df.sort_values("timestamp"),
            funding[["timestamp", "funding_rate"]].sort_values("timestamp"),
            on="timestamp",
            direction="backward",
        )
    else:
        df["funding_rate"] = 0.0

    # Long/Short ratio placeholder (not in historical data - set neutral)
    df["long_short_ratio"] = 0.5

    # Sentiment placeholder (historical F&G not easily available - neutral)
    df["fear_greed_value"] = 50

    # Taapi placeholders (match Layer 1 values)
    df["taapi_rsi"] = df["rsi_14"]
    df["taapi_macd_signal"] = macd.macd_signal()

    # Time features
    df["hour_of_day"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    # Label: 1 if price moves up ≥ 0.8% within next LABEL_HORIZON candles
    df["future_max"] = df["close"].shift(-1).rolling(LABEL_HORIZON).max().shift(-(LABEL_HORIZON - 1))
    df["label"] = ((df["future_max"] - df["close"]) / df["close"] >= LABEL_TARGET).astype(int)

    feature_cols = [
        "ema_cross_9_21", "ema_cross_21_50", "rsi_14", "macd_histogram",
        "bb_squeeze", "volume_ratio", "oi_change_pct_15m", "oi_change_pct_1h",
        "funding_rate", "long_short_ratio", "fear_greed_value",
        "taapi_rsi", "taapi_macd_signal",
        "hour_of_day", "day_of_week", "is_weekend",
    ]

    result = df[feature_cols + ["label", "timestamp"]].dropna()
    return result


def _read_ts(path, **kwargs) -> pd.DataFrame:
    """Read CSV and ensure the timestamp column is a tz-aware UTC datetime."""
    df = pd.read_csv(path, **kwargs)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, format="mixed")
    return df


def build_all():
    all_dfs = []
    for symbol in SYMBOLS:
        ohlcv = _read_ts(DATA_DIR / f"ohlcv_{symbol}.csv")
        try:
            oi = _read_ts(DATA_DIR / f"oi_{symbol}.csv")
        except FileNotFoundError:
            oi = pd.DataFrame(columns=["timestamp", "oi"])
        try:
            funding = _read_ts(DATA_DIR / f"funding_{symbol}.csv")
        except FileNotFoundError:
            funding = pd.DataFrame(columns=["timestamp", "funding_rate"])

        features = compute_features(ohlcv, oi, funding)
        features["symbol"] = symbol
        all_dfs.append(features)
        print(f"  {symbol}: {len(features)} feature rows, label balance: {features['label'].mean():.2%}")

    combined = pd.concat(all_dfs, ignore_index=True)
    combined.to_csv(DATA_DIR / "features.csv", index=False)
    print(f"Features saved: {len(combined)} total rows")
    return combined


FEATURE_COLS = [
    "ema_cross_9_21", "ema_cross_21_50", "rsi_14", "macd_histogram",
    "bb_squeeze", "volume_ratio", "oi_change_pct_15m", "oi_change_pct_1h",
    "funding_rate", "long_short_ratio", "fear_greed_value",
    "taapi_rsi", "taapi_macd_signal",
    "hour_of_day", "day_of_week", "is_weekend",
]

if __name__ == "__main__":
    build_all()
