import { describe, it, expect, beforeEach } from "vitest";
import {
  registerUser,
  authenticateUser,
  validateSession,
  terminateSession,
  initDemoAccount,
  isDemoAccountEnabled,
  _clearUsersAndSessionsForTest,
} from "../auth.js";

describe("Sentinel Wallet — Authentication & Session Security", () => {
  beforeEach(() => {
    delete process.env.ENABLE_DEMO_ACCOUNT;
    delete process.env.DEMO_OPERATOR_PASSWORD;
    _clearUsersAndSessionsForTest();
  });

  it("demo account is DISABLED by default unless ENABLE_DEMO_ACCOUNT=true", () => {
    expect(isDemoAccountEnabled()).toBe(false);
    const res = authenticateUser("operator@sentinel.wallet", "SentinelDemo2026!");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid email or password");
  });

  it("demo account can only be enabled explicitly via ENABLE_DEMO_ACCOUNT=true", () => {
    process.env.ENABLE_DEMO_ACCOUNT = "true";
    expect(isDemoAccountEnabled()).toBe(true);
    const seeded = initDemoAccount(true);
    expect(seeded).toBe(true);

    const res = authenticateUser("operator@sentinel.wallet", "SentinelDemo2026!");
    expect(res.success).toBe(true);
    expect(res.session).toBeDefined();
    expect(res.user?.email).toBe("operator@sentinel.wallet");
    expect(res.user?.walletSetupCompleted).toBe(true);
  });

  it("refuses to seed demo account with default hardcoded password in production", () => {
    process.env.ENABLE_DEMO_ACCOUNT = "true";
    process.env.NODE_ENV = "production";
    delete process.env.DEMO_OPERATOR_PASSWORD;

    const seeded = initDemoAccount();
    expect(seeded).toBe(false);

    // Reset NODE_ENV
    delete process.env.NODE_ENV;
  });

  it("accepts explicitly configured DEMO_OPERATOR_PASSWORD in production", () => {
    process.env.ENABLE_DEMO_ACCOUNT = "true";
    process.env.NODE_ENV = "production";
    process.env.DEMO_OPERATOR_PASSWORD = "CustomSecureDemoPass2026!";

    const seeded = initDemoAccount();
    expect(seeded).toBe(true);

    const res = authenticateUser("operator@sentinel.wallet", "CustomSecureDemoPass2026!");
    expect(res.success).toBe(true);

    // Reset NODE_ENV
    delete process.env.NODE_ENV;
  });

  it("registers a new user and authenticates successfully", () => {
    const email = "auditor@fintech.test";
    const pass = "StrongPassword2026!";
    const reg = registerUser(email, pass, "192.168.1.1");
    expect(reg.success).toBe(true);

    const auth = authenticateUser(email, pass, "192.168.1.1");
    expect(auth.success).toBe(true);
    expect(auth.user?.walletSetupCompleted).toBe(false);
  });

  it("enforces minimum password length of 8 chars", () => {
    const reg = registerUser("short@test.com", "short");
    expect(reg.success).toBe(false);
    expect(reg.error).toContain("at least 8 characters");
  });

  it("rate limits registration abuse (max 5 accounts per window per IP)", () => {
    const ip = "10.0.0.42";
    for (let i = 0; i < 5; i++) {
      const reg = registerUser(`user_${i}@test.com`, "ValidPassword123!", ip);
      expect(reg.success).toBe(true);
    }
    // 6th registration from same IP should fail
    const blocked = registerUser("abuser@test.com", "ValidPassword123!", ip);
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("Too many accounts registered");

    // Different IP should still be allowed
    const otherIp = registerUser("other_ip@test.com", "ValidPassword123!", "10.0.0.99");
    expect(otherIp.success).toBe(true);
  });

  it("locks out IP after 5 consecutive failed login attempts", () => {
    const ip = "172.16.0.5";
    registerUser("target@test.com", "CorrectPassword123!", ip);

    for (let i = 0; i < 5; i++) {
      const attempt = authenticateUser("target@test.com", "WrongPassword!", ip);
      expect(attempt.success).toBe(false);
      expect(attempt.error).toBe("Invalid email or password");
    }

    // 6th attempt should return lockout message even with correct password
    const locked = authenticateUser("target@test.com", "CorrectPassword123!", ip);
    expect(locked.success).toBe(false);
    expect(locked.error).toContain("Too many failed attempts");
  });

  it("invalidates session on logout", () => {
    registerUser("user@logout.test", "Password123!", "127.0.0.1");
    const auth = authenticateUser("user@logout.test", "Password123!", "127.0.0.1");
    const sid = auth.session!.sessionId;

    expect(validateSession(sid).valid).toBe(true);
    terminateSession(sid);
    expect(validateSession(sid).valid).toBe(false);
  });
});
