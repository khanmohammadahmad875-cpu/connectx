const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokens');

// Verifies the Bearer access token and loads the user. 401 when missing/invalid.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Unauthorized: missing token' });

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.isDeactivated) {
      return res.status(401).json({ message: 'Unauthorized: account not active' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account suspended by an administrator' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
