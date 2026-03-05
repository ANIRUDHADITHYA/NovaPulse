'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const telegram = require('../services/telegram');

async function triggerRetrain() {
  const url = process.env.ML_SERVICE_URL;
  if (!url) {
    logger.warn('[RetrainJob] ML_SERVICE_URL not set — skipping weekly retrain');
    telegram.send('⚠️ Weekly ML retrain skipped — ML_SERVICE_URL is not configured');
    return;
  }
  logger.info('[RetrainJob] Triggering weekly ML model retraining');

  try {
    await axios.post(`${url}/retrain`, {}, { timeout: 10000 });
    logger.info('[RetrainJob] Retrain started. Polling for completion...');

    // Poll every 2 minutes until done or failed
    let attempts = 0;
    const maxAttempts = 60; // 2 hours max

    const poll = setInterval(async () => {
      attempts++;
      try {
        const res = await axios.get(`${url}/retrain/status`);
        const { status } = res.data;

        if (status === 'completed') {
          clearInterval(poll);
          const { last_f1, degraded, degraded_detail, top_features } = res.data;
          if (degraded && degraded_detail) {
            const { old_f1, new_f1 } = degraded_detail;
            const msg = `⚠️ ML RETRAIN DEGRADED — rolled back (old F1: ${Number(old_f1).toFixed(2)}, new F1: ${Number(new_f1).toFixed(2)})`;
            logger.warn(`[RetrainJob] ${msg}`);
            telegram.send(msg);
          } else {
            const featureLines = top_features
              ? Object.entries(top_features)
                  .map(([f, s]) => `  ${f}: ${s}`)
                  .join('\n')
              : '  (unavailable)';
            const msg = `✅ ML Model retrained | F1: ${last_f1}\n📊 Top features:\n${featureLines}`;
            logger.info(`[RetrainJob] Retrain completed. F1: ${last_f1}`);
            telegram.send(msg);
          }
        } else if (status === 'failed') {
          clearInterval(poll);
          logger.error('[RetrainJob] Retrain failed');
          telegram.send('⚠️ ML Model retraining FAILED — check ml-service logs');
        }
      } catch (err) {
        logger.error(`[RetrainJob] Polling error: ${err.message}`);
      }

      if (attempts >= maxAttempts) {
        clearInterval(poll);
        logger.error('[RetrainJob] Retrain polling timed out after 2 hours');
      }
    }, 120000);
  } catch (err) {
    logger.error(`[RetrainJob] Failed to trigger retrain: ${err.message}`);
  }
}

module.exports = { triggerRetrain };
