import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../constants.js";
import { readSessionRecord } from "../lib/database.js";

export function authenticateToken(request, response, next) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    response.status(401).json({ error: "请先登录。" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    request.user = { id: decoded.userId, username: decoded.username, role: decoded.role || "user" };
    next();
  } catch (error) {
    response.status(401).json({ error: "登录已过期，请重新登录。" });
  }
}

export function requireSessionOwnership(sessionHashParam = "sessionHash") {
  return async (request, response, next) => {
    const sessionHash = request.params[sessionHashParam] || request.body?.sessionHash;

    if (!sessionHash) {
      response.status(400).json({ error: "sessionHash 不能为空。" });
      return;
    }

    const session = readSessionRecord(sessionHash);

    if (!session) {
      response.status(404).json({ error: "会话不存在。" });
      return;
    }

    if (session.userId != null && session.userId !== request.user.id) {
      response.status(403).json({ error: "无权访问该会话。" });
      return;
    }

    next();
  };
}
