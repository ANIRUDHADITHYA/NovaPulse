'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const PLACEHOLDER_RE = /^your_/i;

function send(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.warn('[Telegram] Missing BOT_TOKEN or CHAT_ID — alert suppressed');
    return;
  }

  if (PLACEHOLDER_RE.test(token) || PLACEHOLDER_RE.test(chatId)) {
    logger.warn('[Telegram] BOT_TOKEN/CHAT_ID still set to placeholder values — update .env to enable alerts');
    return;
  }

  axios
    .post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    })
    .catch((err) => logger.error(`[Telegram] Failed to send alert: ${err.message}`));
}

module.exports = { send };
