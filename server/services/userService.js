import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../constants.js";
import { createUserRecord, findUserByUsername, findUserById, getDatabase } from "../lib/database.js";

function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

function countUsers() {
  const db = getDatabase();
  return db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
}

export async function registerUser(username, password) {
  const trimmedUsername = `${username ?? ""}`.trim();
  const trimmedPassword = `${password ?? ""}`.trim();

  if (!trimmedUsername || trimmedUsername.length < 2) {
    const error = new Error("用户名至少需要 2 个字符。");
    error.status = 400;
    throw error;
  }

  if (!trimmedPassword || trimmedPassword.length < 4) {
    const error = new Error("密码至少需要 4 个字符。");
    error.status = 400;
    throw error;
  }

  const existingUser = findUserByUsername(trimmedUsername);

  if (existingUser) {
    const error = new Error("该用户名已被注册。");
    error.status = 409;
    throw error;
  }

  const isFirstUser = countUsers() === 0;
  const role = isFirstUser ? "admin" : "user";
  const passwordHash = await bcrypt.hash(trimmedPassword, 10);
  const user = createUserRecord(trimmedUsername, passwordHash, role);
  const token = signToken(user);

  return {
    user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
    token,
  };
}

export async function loginUser(username, password) {
  const trimmedUsername = `${username ?? ""}`.trim();
  const trimmedPassword = `${password ?? ""}`.trim();

  if (!trimmedUsername || !trimmedPassword) {
    const error = new Error("用户名和密码不能为空。");
    error.status = 400;
    throw error;
  }

  const user = findUserByUsername(trimmedUsername);

  if (!user) {
    const error = new Error("用户名或密码错误。");
    error.status = 401;
    throw error;
  }

  const passwordValid = await bcrypt.compare(trimmedPassword, user.passwordHash);

  if (!passwordValid) {
    const error = new Error("用户名或密码错误。");
    error.status = 401;
    throw error;
  }

  const token = signToken(user);

  return {
    user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
    token,
  };
}

export function getUserById(id) {
  return findUserById(id);
}

export function isAdmin(user) {
  return user?.role === "admin";
}
