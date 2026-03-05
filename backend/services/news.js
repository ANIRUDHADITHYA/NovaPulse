'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { REDIS_KEYS } = require('../config/constants');

const NEWS_API_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';
const VETO_WINDOW_MS = 15 * 60 * 1000; // 15 minutes (one candle period)
const VETO_TTL_S = 15 * 60;            // 15 minutes in seconds
const CACHE_TTL_S = 16 * 60;           // 16 minutes in seconds

// Case-insensitive keywords — ONLY truly catastrophic, market-halting events.
// Do NOT include common market vocabulary (liquidation, regulation, inflation)
// as they appear in normal articles and would block all trading permanently.
const VETO_KEYWORDS = [
  'FOMC', 'CPI', 'hack', 'exploit', 'bankruptcy', 'emergency',
  'circuit breaker', 'exchange halt', 'trading halt', 'SEC lawsuit',
];

let redisClient;

function init(redis) {
  redisClient = redis;
}

/**
 * Fetch latest crypto news from CryptoCompare, check for veto keywords published
 * within the last 30 minutes, and set NEWS_VETO in Redis if a match is found.
 *
 * Fail-open: if the API request fails, log a warning and allow signals through.
 */
async function fetchAndCheckNews() {
  let articles;

  try {
    const res = await axios.get(NEWS_API_URL, { timeout: 10000 });
    if (res.status !== 200 || !Array.isArray(res.data?.Data)) {
      throw new Error(`Unexpected response: status ${res.status}`);
    }
    articles = res.data.Data;

    // Cache raw response with 16-min TTL so signal engine can re-check without a new request
    await redisClient.set('news_cache', JSON.stringify(articles), 'EX', CACHE_TTL_S);
  } catch (err) {
    // Fail-open: do NOT set veto — a news API outage must not halt trading
    logger.warn(`WARN: CryptoCompare news fetch failed — news filter bypassed for this candle: ${err.message}`);
    return null;
  }

  const cutoff = Date.now() - VETO_WINDOW_MS;
  const keywordRegex = new RegExp(VETO_KEYWORDS.join('|'), 'i');

  for (const article of articles) {
    // CryptoCompare returns published_on (Unix seconds) — guard against missing/undefined field
    const rawTs = article.published_on ?? article.publishedOn;
    const publishedAt = rawTs ? rawTs * 1000 : NaN;
    if (isNaN(publishedAt) || publishedAt < cutoff) continue; // skip stale or undated articles

    // Check title only — body text always contains market vocabulary in context
    // (e.g. "despite regulatory concerns") which would trigger constant false vetoes
    const text = article.title || '';
    if (keywordRegex.test(text)) {
      await redisClient.set(REDIS_KEYS.NEWS_VETO, '1', 'EX', VETO_TTL_S);
      logger.warn(`[News] Veto triggered — article: "${article.title}" published ${new Date(publishedAt).toISOString()}`);
      return { vetoed: true, title: article.title };
    }
  }

  // No matching article — clear any stale veto if it expired naturally (Redis TTL handles it)
  logger.info('[News] No veto keywords found in recent articles');
  return { vetoed: false };
}

module.exports = { init, fetchAndCheckNews };
