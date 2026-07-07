import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn((pw) => Promise.resolve(`hashed_${pw}`)),
    compare: vi.fn((pw, hash) => Promise.resolve(hash === `hashed_${pw}`)),
  },
  hash: vi.fn((pw) => Promise.resolve(`hashed_${pw}`)),
  compare: vi.fn((pw, hash) => Promise.resolve(hash === `hashed_${pw}`)),
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(() => "mocked-jwt-token"),
  },
  sign: vi.fn(() => "mocked-jwt-token"),
}));

const mockUserRecord = { id: 1, username: "testuser", passwordHash: "hashed_pass1234", role: "user", createdAt: "2024-01-01" };
let mockUsers = [];

vi.mock("../lib/database.js", () => ({
  createUserRecord: vi.fn((username, passwordHash, role) => {
    const user = { id: mockUsers.length + 1, username, passwordHash, role, createdAt: "2024-01-01" };
    mockUsers.push(user);
    return user;
  }),
  findUserByUsername: vi.fn((username) => mockUsers.find((u) => u.username === username) ?? null),
  findUserById: vi.fn((id) => mockUsers.find((u) => u.id === id) ?? null),
  updateUserPassword: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ count: mockUsers.length })),
    })),
  })),
}));

import { registerUser, loginUser, changePassword, getUserById, isAdmin } from "../services/userService.js";
import * as database from "../lib/database.js";

describe("userService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsers = [{ ...mockUserRecord }];
  });

  describe("registerUser", () => {
    it("should register first user as admin", async () => {
      mockUsers = []; // no existing users
      const result = await registerUser("admin1", "adminpass");
      expect(result.user.role).toBe("admin");
      expect(result.token).toBe("mocked-jwt-token");
    });

    it("should register subsequent users as regular user", async () => {
      const result = await registerUser("user2", "pass1234");
      expect(result.user.role).toBe("user");
    });

    it("should reject duplicate username", async () => {
      await expect(registerUser("testuser", "pass1234")).rejects.toThrow("已被注册");
    });

    it("should reject short username", async () => {
      await expect(registerUser("a", "pass1234")).rejects.toThrow("至少需要 2");
    });

    it("should reject short password", async () => {
      await expect(registerUser("newuser", "ab")).rejects.toThrow("至少需要 4");
    });
  });

  describe("loginUser", () => {
    it("should login with correct credentials", async () => {
      const result = await loginUser("testuser", "pass1234");
      expect(result.token).toBe("mocked-jwt-token");
      expect(result.user.username).toBe("testuser");
    });

    it("should reject wrong password", async () => {
      await expect(loginUser("testuser", "wrongpass")).rejects.toThrow("用户名或密码错误");
    });

    it("should reject nonexistent user", async () => {
      await expect(loginUser("nobody", "pass")).rejects.toThrow("用户名或密码错误");
    });

    it("should reject empty credentials", async () => {
      await expect(loginUser("", "")).rejects.toThrow("不能为空");
    });
  });

  describe("changePassword", () => {
    it("should change password with correct old password", async () => {
      const result = await changePassword(1, "pass1234", "newpass1234");
      expect(result.ok).toBe(true);
    });

    it("should reject wrong old password", async () => {
      await expect(changePassword(1, "wrongold", "newpass")).rejects.toThrow("当前密码错误");
    });

    it("should reject nonexistent user", async () => {
      await expect(changePassword(999, "old", "new")).rejects.toThrow("用户不存在");
    });
  });

  describe("getUserById", () => {
    it("should return user by id", () => {
      const user = getUserById(1);
      expect(user.username).toBe("testuser");
    });

    it("should return null for nonexistent id", () => {
      expect(getUserById(999)).toBeNull();
    });
  });

  describe("isAdmin", () => {
    it("should return true for admin role", () => {
      expect(isAdmin({ role: "admin" })).toBe(true);
    });

    it("should return false for user role", () => {
      expect(isAdmin({ role: "user" })).toBe(false);
    });

    it("should return false for undefined/null", () => {
      expect(isAdmin(null)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
    });
  });
});
