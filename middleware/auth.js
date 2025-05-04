const jwt = require('jsonwebtoken');

// Renamed for clarity - this is an auth middleware, not "Todos"
const auth = (req, res, next) => {
  const token = req.header('auth-token');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    
    // Set the user ID consistently
    req.user = { id: decoded.userId };
    
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = auth;