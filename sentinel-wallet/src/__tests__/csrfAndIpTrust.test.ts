import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";
import {
  handleRequest,
  initializeManager,
  isAllowedOrigin,
  getClientIp,
  normalizeIp,
  _resetUserSettingsForTest,
} from "../server.js";
import { _clearUsersAndSessionsForTest, registerUser, authenticateUser } from "../auth.js";

describe("Sentinel Wallet — CSRF Defense & Registration IP Trust", () => {
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
  });

  beforeEach(() => {
    delete process.env.TRUSTED_PROXIES;
    delete process.env.ALLOWED_ORIGINS;
    _clearUsersAndSessionsForTest();
    _resetUserSettingsForTest();
  });

  describe("Fix 2: CSRF Origin Enforcement on Cookie-Authenticated Requests", () => {
    it("tests isAllowedOrigin for allowed, disallowed, missing, and null origins", () => {
      expect(isAllowedOrigin(undefined)).toBe(false);
      expect(isAllowedOrigin("")).toBe(false);
      expect(isAllowedOrigin("null")).toBe(false);
      expect(isAllowedOrigin("http://evil.com")).toBe(false);
      expect(isAllowedOrigin("https://attacker.example.org")).toBe(false);

      // Localhost & 127.0.0.1 are allowed
      expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);

      // Custom ALLOWED_ORIGINS
      process.env.ALLOWED_ORIGINS = "https://sentinel.app, https://demo.sentinel.internal";
      expect(isAllowedOrigin("https://sentinel.app")).toBe(true);
      expect(isAllowedOrigin("https://demo.sentinel.internal")).toBe(true);
      expect(isAllowedOrigin("https://rogue-sentinel.app")).toBe(false);
    });

    it("cookie-authenticated POST rejects missing origin with 403 Forbidden", async () => {
      registerUser("csrf1@sentinel.test", "Password123!");
      const auth = authenticateUser("csrf1@sentinel.test", "Password123!");
      const cookie = `sentinel_session=${auth.session!.sessionId}`;

      // POST /api/pause with Cookie and NO Origin header
      const res = await fetch(`${baseUrl}/api/pause`, {
        method: "POST",
        headers: {
          Cookie: cookie,
        },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("CSRF check failed");
    });

    it("cookie-authenticated POST rejects 'null' origin with 403 Forbidden", async () => {
      registerUser("csrf2@sentinel.test", "Password123!");
      const auth = authenticateUser("csrf2@sentinel.test", "Password123!");
      const cookie = `sentinel_session=${auth.session!.sessionId}`;

      // POST /api/pause with Cookie and Origin: "null" (e.g. from sandboxed iframe)
      const res = await fetch(`${baseUrl}/api/pause`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "null",
        },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("CSRF check failed");
    });

    it("cookie-authenticated POST rejects disallowed origin with 403 Forbidden", async () => {
      registerUser("csrf3@sentinel.test", "Password123!");
      const auth = authenticateUser("csrf3@sentinel.test", "Password123!");
      const cookie = `sentinel_session=${auth.session!.sessionId}`;

      // POST /api/pause with Cookie and evil Origin
      const res = await fetch(`${baseUrl}/api/pause`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://malicious-website.com",
        },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("CSRF check failed");
    });

    it("cookie-authenticated POST succeeds with allowed origin", async () => {
      registerUser("csrf4@sentinel.test", "Password123!");
      const auth = authenticateUser("csrf4@sentinel.test", "Password123!");
      const cookie = `sentinel_session=${auth.session!.sessionId}`;

      // POST /api/pause with Cookie and allowed Origin (http://127.0.0.1:port)
      const res = await fetch(`${baseUrl}/api/pause`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: baseUrl,
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; isPaused: boolean };
      expect(data.ok).toBe(true);
      expect(data.isPaused).toBe(true);
    });

    it("Bearer-token authenticated POST succeeds even with missing or null origin (non-ambient credentials)", async () => {
      registerUser("bearer@sentinel.test", "Password123!");
      const auth = authenticateUser("bearer@sentinel.test", "Password123!");
      const token = auth.session!.sessionId;

      // 1. Missing Origin with Bearer token
      const resNoOrigin = await fetch(`${baseUrl}/api/pause`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(resNoOrigin.status).toBe(200);

      // 2. Origin: "null" with Bearer token
      const resNullOrigin = await fetch(`${baseUrl}/api/unpause`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "null",
        },
      });
      expect(resNullOrigin.status).toBe(200);
    });
  });

  describe("Fix 3: Registration IP Trust & X-Forwarded-For Spoofing Resistance", () => {
    it("normalizes IPv6 mapped IPv4 addresses correctly", () => {
      expect(normalizeIp("::ffff:192.168.1.1")).toBe("192.168.1.1");
      expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1");
      expect(normalizeIp(undefined)).toBe("unknown");
    });

    it("client cannot bypass registration rate limits by changing X-Forwarded-For when no trusted proxy is configured", async () => {
      // Direct connection to HTTP server: req.socket.remoteAddress will be 127.0.0.1
      // No TRUSTED_PROXIES is configured.
      // An attacker sends 5 requests with spoofed X-Forwarded-For headers.
      for (let i = 1; i <= 5; i++) {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": `198.51.100.${i}`, // Rotating spoofed IPs
          },
          body: JSON.stringify({
            email: `spoof_user_${i}@sentinel.test`,
            password: "Password123!",
          }),
        });
        expect(res.status).toBe(200);
      }

      // The 6th request with yet another spoofed IP must FAIL because server tracks direct socket IP
      const blockedRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.99",
        },
        body: JSON.stringify({
          email: "spoof_user_6@sentinel.test",
          password: "Password123!",
        }),
      });

      expect(blockedRes.status).toBe(400);
      const data = (await blockedRes.json()) as { error: string };
      expect(data.error).toContain("Too many accounts registered from this IP");
    });

    it("getClientIp correctly extracts client IP when connection comes from an explicit trusted proxy", () => {
      process.env.TRUSTED_PROXIES = "10.0.0.1, 10.0.0.2";

      // 1. Connection from trusted proxy (10.0.0.1): respects X-Forwarded-For
      const reqFromTrustedProxy = {
        socket: { remoteAddress: "10.0.0.1" },
        headers: {
          "x-forwarded-for": "203.0.113.195, 10.0.0.1",
        },
      } as unknown as IncomingMessage;
      expect(getClientIp(reqFromTrustedProxy)).toBe("203.0.113.195");

      // 2. Connection from untrusted proxy (192.168.1.50): ignores X-Forwarded-For, uses socket address
      const reqFromUntrusted = {
        socket: { remoteAddress: "192.168.1.50" },
        headers: {
          "x-forwarded-for": "203.0.113.195",
        },
      } as unknown as IncomingMessage;
      expect(getClientIp(reqFromUntrusted)).toBe("192.168.1.50");

      // 3. No trusted proxies configured in environment: ignores X-Forwarded-For
      delete process.env.TRUSTED_PROXIES;
      const reqNoEnv = {
        socket: { remoteAddress: "127.0.0.1" },
        headers: {
          "x-forwarded-for": "8.8.8.8",
        },
      } as unknown as IncomingMessage;
      expect(getClientIp(reqNoEnv)).toBe("127.0.0.1");
    });
  });
});
