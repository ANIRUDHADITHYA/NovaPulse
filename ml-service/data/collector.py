"""
data/collector.py — Fetch historical OHLCV + OI data from Binance
"""

import os
import time
import requests
import pandas as pd
from pathlib import Path

BASE_URL = "https://api.binance.com"
FUTURES_URL = "https://fapi.binance.com"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"]
INTERVAL = "15m"
LOOKBACK_DAYS = 180  # 6 months

DATA_DIR = Path(__file__).parent


def fetch_klines(symbol: str, interval: str, lookback_days: int) -> pd.DataFrame:
    limit = 1000
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - lookback_days * 86400 * 1000
    all_rows = []

    while start_ms < end_ms:
        url = f"{BASE_URL}/api/v3/klines"
        params = {"symbol": symbol, "interval": interval, "startTime": start_ms, "limit": limit}
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        all_rows.extend(data)
        start_ms = data[-1][0] + 1
        time.sleep(0.2)

    df = pd.DataFrame(all_rows, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades", "taker_base", "taker_quote", "ignore",
    ])
    df["timestamp"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    return df[["timestamp", "open", "high", "low", "close", "volume"]].reset_index(drop=True)


OI_MAX_DAYS = 7  # Binance openInterestHist 5m: reliable retention ~7 days
OI_PERIODS = ("5m", "15m", "1h")  # fallback chain if a finer period fails


def fetch_oi_history(symbol: str, lookback_days: int) -> pd.DataFrame:
    """Fetch Open Interest history with automatic period fallback.

    Binance retains 5-min OI data for ~7 days; if that window or finer
    periods return a 400, the function retries with coarser periods and
    finally returns an empty DataFrame rather than crashing.
    """
    limit = 500
    end_ms = int(time.time() * 1000)
    effective_days = min(lookback_days, OI_MAX_DAYS)
    start_ms = end_ms - effective_days * 86400 * 1000

    for period in OI_PERIODS:
        all_rows = []
        cur_start = start_ms
        try:
            while cur_start < end_ms:
                url = f"{FUTURES_URL}/futures/data/openInterestHist"
                params = {"symbol": symbol, "period": period,
                          "startTime": cur_start, "limit": limit}
                resp = requests.get(url, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                if not data:
                    break
                all_rows.extend(data)
                cur_start = data[-1]["timestamp"] + 1
                time.sleep(0.3)
            # Successfully fetched (possibly 0 rows — still a clean exit)
            break
        except requests.exceptions.HTTPError as exc:
            print(f"[OI] {symbol} period={period} failed: {exc} — trying next period")
            all_rows = []

    if not all_rows:
        print(f"[OI] {symbol}: no OI data available — filling with zeros")
        return pd.DataFrame(columns=["timestamp", "oi"])

    df = pd.DataFrame(all_rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df["oi"] = df["sumOpenInterest"].astype(float)
    return df[["timestamp", "oi"]].reset_index(drop=True)


def fetch_funding_rate(symbol: str, lookback_days: int) -> pd.DataFrame:
    limit = 1000
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - lookback_days * 86400 * 1000
    all_rows = []

    try:
        while start_ms < end_ms:
            url = f"{FUTURES_URL}/fapi/v1/fundingRate"
            params = {"symbol": symbol, "startTime": start_ms, "limit": limit}
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            all_rows.extend(data)
            start_ms = data[-1]["fundingTime"] + 1
            time.sleep(0.3)
    except requests.exceptions.HTTPError as exc:
        print(f"[Funding] {symbol} fetch failed: {exc} — using empty funding data")
        all_rows = []

    if not all_rows:
        return pd.DataFrame(columns=["timestamp", "funding_rate"])

    df = pd.DataFrame(all_rows)
    df["timestamp"] = pd.to_datetime(df["fundingTime"], unit="ms", utc=True)
    df["funding_rate"] = df["fundingRate"].astype(float)
    return df[["timestamp", "funding_rate"]].reset_index(drop=True)


def collect_all():
    for symbol in SYMBOLS:
        print(f"Collecting {symbol}...")
        try:
            ohlcv = fetch_klines(symbol, INTERVAL, LOOKBACK_DAYS)
            oi = fetch_oi_history(symbol, LOOKBACK_DAYS)
            funding = fetch_funding_rate(symbol, LOOKBACK_DAYS)

            ohlcv.to_csv(DATA_DIR / f"ohlcv_{symbol}.csv", index=False)
            oi.to_csv(DATA_DIR / f"oi_{symbol}.csv", index=False)
            funding.to_csv(DATA_DIR / f"funding_{symbol}.csv", index=False)
            print(f"  {symbol}: {len(ohlcv)} candles, {len(oi)} OI records, {len(funding)} funding records")
        except Exception as exc:
            print(f"  ERROR collecting {symbol}: {exc} — skipping")


if __name__ == "__main__":
    collect_all()
    print("Data collection complete.")
