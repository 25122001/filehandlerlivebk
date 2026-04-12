const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "No token" });
    }

    // Support Bearer token
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    const decoded = jwt.verify(token, process.env.SECRET_KEY);

    const user = await User.findById(decoded.id);

    // ✅ Check token match
    if (!user || user.token !== token) {
      return res.status(401).json({ message: "Invalid session" });
    }

    // ✅ Check expiry
    if (new Date() > user.tokenExpiry) {
      user.token = null;
      user.tokenExpiry = null;
      await user.save();

      return res.status(401).json({ message: "Session expired" });
    }

    req.user = user;
    next();

  } catch (err) {
    res.status(401).json({ message: "Unauthorized" });
  }
};

module.exports = authMiddleware;