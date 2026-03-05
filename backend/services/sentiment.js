'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { REDIS_KEYS, FEAR_GREED_BUY_MAX, FEAR_GREED_VETO } = require('../config/constants');
const emitter = require('../socket/emitter');

let redisClient;

function init(redis) {
  redisClient = redis;
}

async function fetchSentiment() {
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1');
    const data = res.data.data[0];
    const result = {
      value: parseInt(data.value, 10),
      classification: data.value_classification,
      timestamp: new Date().toISOString(),
    };
    await redisClient.set(REDIS_KEYS.SENTIMENT, JSON.stringify(result), 'EX', 3900); // 65 min

    // Push to dashboard (SentimentBar.jsx) — matches Socket.io event schema
    emitter.emit('sentiment:update', result);

    logger.info(`[Sentiment] F&G: ${result.value} (${result.classification})`);
    return result;
  } catch (err) {
    logger.error(`[Sentiment] Failed to fetch Fear & Greed Index: ${err.message}`);
    return null;
  }
}

async function getLatestSentiment() {
  const cached = await redisClient.get(REDIS_KEYS.SENTIMENT);
  return cached ? JSON.parse(cached) : null;
}

/**
 * Layer 4 vote: +1 buy zone, -1 avoid, 'veto' if extreme greed
 */
function scoreSentiment(sentimentData) {
  if (!sentimentData) return 0;
  const v = sentimentData.value;
  if (v >= FEAR_GREED_VETO) return 'veto';
  if (v < FEAR_GREED_BUY_MAX) return 1;
  if (v <= 55) return 0;
  return -1;
}

module.exports = { init, fetchSentiment, getLatestSentiment, scoreSentiment };
