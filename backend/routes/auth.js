'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/auth/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const stored = process.env.DASHBOARD_PASSWORD;
  let valid = false;
  // Support plain or bcrypt hashed password in .env
  if (stored.startsWith('$2')) {
    valid = await bcrypt.compare(password, stored);
  } else {
    valid = password === stored;
  }

  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 86400000,
  });
  res.json({ success: true });
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.json({ success: true });
});

router.get('/auth/me', require('../middleware/auth'), (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

module.exports = router;
