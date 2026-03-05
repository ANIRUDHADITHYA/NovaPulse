'use strict';

const jwt = require('jsonwebtoken');

/**
 * JWT verification middleware.
 * Reads JWT from httpOnly cookie, verifies, attaches decoded payload to req.user.
 */
function auth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized — no token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
}

module.exports = auth;
