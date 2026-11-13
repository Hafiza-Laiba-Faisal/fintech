import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "http";
import { handleRequest, initializeManager, _resetUserSettingsForTest } from "../server.js";
import { _clearUsersAndSessionsForTest } from "../auth.js";

describe("Sentinel Wallet — HTTP Multi-User Isolation Integration Tests", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await initializeManager();
    server = createServer(handleRequest);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  // Allow up to 15 s for the server to drain open keep-alive connections.
  }, 15_000);

  beforeEach(() => {
    _clearUsersAndSessionsForTest();
    _resetUserSettingsForTest();
  });

  it("proves complete multi-user policy isolation over HTTP routes", async () => {
    const origin = baseUrl;

    // 1. Register User A and User B
    const regResA = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "userA@sentinel.test", password: "Password123!UserA" }),
    });
    expect(regResA.status).toBe(200);
    const regDataA = (await regResA.json()) as { success: boolean; user: { id: string } };
    expect(regDataA.success).toBe(true);

    const regResB = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "userB@sentinel.test", password: "Password123!UserB" }),
    });
    expect(regResB.status).toBe(200);
    const regDataB = (await regResB.json()) as { success: boolean; user: { id: string } };
    expect(regDataB.success).toBe(true);

    // 2. Authenticate User A and User B to get separate session cookies/tokens
    const loginResA = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "userA@sentinel.test", password: "Password123!UserA" }),
    });
    expect(loginResA.status).toBe(200);
    const loginDataA = (await loginResA.json()) as { success: boolean; token: string };
    const cookieA = loginResA.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookieA).toContain("sentinel_session=");

    const loginResB = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "userB@sentinel.test", password: "Password123!UserB" }),
    });
    expect(loginResB.status).toBe(200);
    const loginDataB = (await loginResB.json()) as { success: boolean; token: string };
    const cookieB = loginResB.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookieB).toContain("sentinel_session=");
    expect(loginDataA.token).not.toBe(loginDataB.token);

    // 3. User A configures restrictive custom settings via POST /api/settings
    // - Daily limit: 25 USDC
    // - Per-tx ceiling: 10 USDC
    // - Allowlist: vendor A only
    const vendorA = "0xE06D8999DCfc16366A7A1C0189C22Bb9521940db";
    const updateResA = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieA,
        Origin: origin,
      },
      body: JSON.stringify({
        wallet: {
          dailyLimitUsdc: 25,
          perTxCeilingUsdc: 10,
          allowlist: [vendorA],
        },
      }),
    });
    expect(updateResA.status).toBe(200);

    // 4. User A triggers emergency pause via POST /api/pause
    const pauseResA = await fetch(`${baseUrl}/api/pause`, {
      method: "POST",
      headers: { Cookie: cookieA, Origin: origin },
    });
    expect(pauseResA.status).toBe(200);
    const pauseDataA = (await pauseResA.json()) as { ok: boolean; isPaused: boolean };
    expect(pauseDataA.isPaused).toBe(true);

    // 5. Verify User B reads settings via GET /api/settings:
    // User B's settings MUST be unaffected: default daily limit (100), default ceiling (50), isPaused=false
    const settingsResB = await fetch(`${baseUrl}/api/settings`, {
      headers: { Cookie: cookieB },
    });
    expect(settingsResB.status).toBe(200);
    const settingsB = (await settingsResB.json()) as {
      wallet: { dailyLimitUsdc: number; perTxCeilingUsdc: number; allowlist: string[]; isPaused: boolean };
    };
    expect(settingsB.wallet.dailyLimitUsdc).toBe(100);
    expect(settingsB.wallet.perTxCeilingUsdc).toBe(50);
    expect(settingsB.wallet.isPaused).toBe(false);

    // Verify User A reads settings via GET /api/settings:
    const settingsResA = await fetch(`${baseUrl}/api/settings`, {
      headers: { Cookie: cookieA },
    });
    expect(settingsResA.status).toBe(200);
    const settingsA = (await settingsResA.json()) as {
      wallet: { dailyLimitUsdc: number; perTxCeilingUsdc: number; allowlist: string[]; isPaused: boolean };
    };
    expect(settingsA.wallet.dailyLimitUsdc).toBe(25);
    expect(settingsA.wallet.perTxCeilingUsdc).toBe(10);
    expect(settingsA.wallet.isPaused).toBe(true);

    // 6. User B updates their own settings to different limits:
    // - Daily limit: 500 USDC
    // - Per-tx ceiling: 200 USDC
    // - Allowlist: vendor B only
    const vendorB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const updateResB = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieB,
        Origin: origin,
      },
      body: JSON.stringify({
        wallet: {
          dailyLimitUsdc: 500,
          perTxCeilingUsdc: 200,
          allowlist: [vendorB],
        },
      }),
    });
    expect(updateResB.status).toBe(200);

    // User A's settings remain completely unmodified
    const checkResA = await fetch(`${baseUrl}/api/settings`, {
      headers: { Cookie: cookieA },
    });
    const checkA = (await checkResA.json()) as {
      wallet: { dailyLimitUsdc: number; perTxCeilingUsdc: number; allowlist: string[]; isPaused: boolean };
    };
    expect(checkA.wallet.dailyLimitUsdc).toBe(25);
    expect(checkA.wallet.perTxCeilingUsdc).toBe(10);
    expect(checkA.wallet.allowlist).toEqual([vendorA]);
    expect(checkA.wallet.isPaused).toBe(true);

    // 7. Verify production policy evaluation via POST /api/plan
    // While User A is paused: User A's plan request MUST be rejected due to wallet_paused
    const planPausedA = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieA,
        Origin: origin,
      },
      body: JSON.stringify({
        instruction: `Send 5 USDC to ${vendorA}`,
      }),
    });
    expect(planPausedA.status).toBe(200);
    const planDataPausedA = (await planPausedA.json()) as {
      success: boolean;
      decision: { status: string; failedCheck?: string; reason: string };
    };
    expect(planDataPausedA.decision.status).toBe("rejected");
    expect(planDataPausedA.decision.failedCheck).toBe("wallet_paused");

    // Meanwhile, User B is NOT paused and sends 5 USDC to vendorB -> approved!
    const planB = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieB,
        Origin: origin,
      },
      body: JSON.stringify({
        instruction: `Send 5 USDC to ${vendorB}`,
      }),
    });
    expect(planB.status).toBe(200);
    const planDataB = (await planB.json()) as {
      success: boolean;
      decision: { status: string; checks: { check: string; passed: boolean }[] };
    };
    expect(planDataB.decision.status).toBe("approved");

    // 8. User A unpauses via POST /api/unpause
    const unpauseResA = await fetch(`${baseUrl}/api/unpause`, {
      method: "POST",
      headers: { Cookie: cookieA, Origin: origin },
    });
    expect(unpauseResA.status).toBe(200);

    // 9. User A tests per-tx ceiling ($10):
    // Instruction for 15 USDC exceeds User A's ceiling ($10) -> rejected by per_tx_ceiling
    const planOverCeilingA = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieA,
        Origin: origin,
      },
      body: JSON.stringify({
        instruction: `Send 15 USDC to ${vendorA}`,
      }),
    });
    expect(planOverCeilingA.status).toBe(200);
    const planDataOverA = (await planOverCeilingA.json()) as {
      success: boolean;
      decision: { status: string; failedCheck?: string; reason: string };
    };
    expect(planDataOverA.decision.status).toBe("rejected");
    expect(planDataOverA.decision.failedCheck).toBe("per_tx_ceiling");
    expect(planDataOverA.decision.reason).toContain("exceeds per-transaction ceiling");

    // User B with $200 ceiling requests 15 USDC to vendorB -> approved!
    const planUnderCeilingB = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieB,
        Origin: origin,
      },
      body: JSON.stringify({
        instruction: `Send 15 USDC to ${vendorB}`,
      }),
    });
    expect(planUnderCeilingB.status).toBe(200);
    const planDataUnderB = (await planUnderCeilingB.json()) as {
      success: boolean;
      decision: { status: string };
    };
    expect(planDataUnderB.decision.status).toBe("approved");

    // 10. User A tries to send to vendorB (which is on User B's allowlist, not User A's):
    // Should be rejected by recipient_allowlist
    const planWrongAllowlistA = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieA,
        Origin: origin,
      },
      body: JSON.stringify({
        instruction: `Send 5 USDC to ${vendorB}`,
      }),
    });
    expect(planWrongAllowlistA.status).toBe(200);
    const planDataAllowlistA = (await planWrongAllowlistA.json()) as {
      success: boolean;
      decision: { status: string; failedCheck?: string };
    };
    expect(planDataAllowlistA.decision.status).toBe("rejected");
    expect(planDataAllowlistA.decision.failedCheck).toBe("recipient_allowlist");
  // 15 000 ms: generous budget for the HTTP round-trips; the LLM is suppressed
  // in test by vitest.config.js env overrides so each /api/plan uses the fast
  // offline regex planner.
  }, 15_000);
});
