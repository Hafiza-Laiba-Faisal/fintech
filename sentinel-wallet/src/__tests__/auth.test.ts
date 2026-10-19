import { describe, it, expect } from "vitest";
import {
  registerUser,
  authenticateUser,
  validateSession,
  terminateSession,
} from "../auth.js";

describe("Sentinel Wallet — Authentication & Session Security", () => {
  it("authenticates the seeded demo operator account", () => {
    const res = authenticateUser("operator@sentinel.wallet", "SentinelDemo2026!");
    expect(res.success).toBe(true);
    expect(res.session).toBeDefined();
    expect(res.session?.sessionId).toBeDefined();
    expect(res.user?.email).toBe("operator@sentinel.wallet");

    const valid = validateSession(res.session?.sessionId);
    expect(valid.valid).toBe(true);
    expect(valid.user?.email).toBe("operator@sentinel.wallet");
  });

  it("rejects invalid password", () => {
    const res = authenticateUser("operator@sentinel.wallet", "WrongPassword123!");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid email or password");
  });

  it("registers a new user and authenticates successfully", () => {
    const email = "auditor@fintech.test";
    const pass = "StrongPassword2026!";
    const reg = registerUser(email, pass);
    expect(reg.success).toBe(true);

    const auth = authenticateUser(email, pass);
    expect(auth.success).toBe(true);
    expect(auth.user?.walletSetupCompleted).toBe(false);
  });

  it("enforces minimum password length of 8 chars", () => {
    const reg = registerUser("short@test.com", "short");
    expect(reg.success).toBe(false);
    expect(reg.error).toContain("at least 8 characters");
  });

  it("invalidates session on logout", () => {
    const auth = authenticateUser("operator@sentinel.wallet", "SentinelDemo2026!");
    const sid = auth.session!.sessionId;

    expect(validateSession(sid).valid).toBe(true);
    terminateSession(sid);
    expect(validateSession(sid).valid).toBe(false);
  });
});
