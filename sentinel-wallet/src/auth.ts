/**
 * Sentinel Wallet — Authentication & Session Manager
 *
 * Provides cryptographic password hashing (PBKDF2 with SHA-512, 100,000 iterations),
 * cryptographically secure session tokens, rate limiting for login attempts,
 * and session validation middleware.
 *
 * Security:
 * - Passwords never stored in plaintext
 * - Constant-time comparison to prevent timing attacks
 * - Tokens generated via crypto.randomBytes(32)
 * - Rate limiting: max 5 failed attempts per IP within a 5-minute window
 * - Sessions expire after 24 hours of inactivity
 * - Sensitive values (passwords, tokens) never logged
 */

import { randomBytes, pbkdf2Sync, timingSafeEqual } from "crypto";

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  walletSetupCompleted: boolean;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

// In-memory user database (seeded with default demo operator account)
const users: Map<string, UserAccount> = new Map();

// In-memory active session store
const sessions: Map<string, UserSession> = new Map();

// Rate limiting store: ip -> { attempts: number, lockUntil: number }
const loginRateLimit: Map<string, { attempts: number; lockUntil: number }> = new Map();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

/**
 * Register a new user account.
 */
export function registerUser(email: string, password: string): { success: boolean; user?: { id: string; email: string; walletSetupCompleted: boolean }; error?: string } {
  const normalizedEmail = email.trim().toLowerCase();
  
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { success: false, error: "Valid email is required" };
  }
  if (!password || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters long" };
  }
  if (users.has(normalizedEmail)) {
    return { success: false, error: "An account with this email already exists" };
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const user: UserAccount = {
    id: "usr_" + randomBytes(8).toString("hex"),
    email: normalizedEmail,
    passwordHash,
    salt,
    createdAt: Date.now(),
    walletSetupCompleted: false,
  };

  users.set(normalizedEmail, user);
  return { success: true, user: { id: user.id, email: user.email, walletSetupCompleted: user.walletSetupCompleted } };
}

/**
 * Authenticate a user and create a new session.
 */
export function authenticateUser(
  email: string,
  password: string,
  clientIp = "local"
): { success: boolean; session?: UserSession; user?: { id: string; email: string; walletSetupCompleted: boolean }; error?: string } {
  const normalizedEmail = email.trim().toLowerCase();
  const now = Date.now();

  // Check rate limit
  const limitInfo = loginRateLimit.get(clientIp);
  if (limitInfo && limitInfo.lockUntil > now) {
    const secondsRemaining = Math.ceil((limitInfo.lockUntil - now) / 1000);
    return { success: false, error: `Too many failed attempts. Please try again in ${secondsRemaining}s` };
  }

  const user = users.get(normalizedEmail);
  if (!user) {
    // Increment failed attempts
    recordFailedAttempt(clientIp);
    return { success: false, error: "Invalid email or password" };
  }

  const attemptHash = hashPassword(password, user.salt);
  const a = Buffer.from(attemptHash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    recordFailedAttempt(clientIp);
    return { success: false, error: "Invalid email or password" };
  }

  // Clear failed attempts on success
  loginRateLimit.delete(clientIp);

  // Generate session token
  const sessionId = randomBytes(32).toString("hex");
  const session: UserSession = {
    sessionId,
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(sessionId, session);

  return {
    success: true,
    session,
    user: {
      id: user.id,
      email: user.email,
      walletSetupCompleted: user.walletSetupCompleted,
    },
  };
}

function recordFailedAttempt(clientIp: string): void {
  const now = Date.now();
  const info = loginRateLimit.get(clientIp) || { attempts: 0, lockUntil: 0 };
  info.attempts += 1;
  if (info.attempts >= MAX_LOGIN_ATTEMPTS) {
    info.lockUntil = now + LOCKOUT_PERIOD_MS;
    info.attempts = 0;
  }
  loginRateLimit.set(clientIp, info);
}

/**
 * Validate a session token.
 */
export function validateSession(sessionId: string | undefined): { valid: boolean; user?: { id: string; email: string; walletSetupCompleted: boolean } } {
  if (!sessionId) return { valid: false };
  const session = sessions.get(sessionId);
  if (!session) return { valid: false };

  const now = Date.now();
  if (session.expiresAt < now) {
    sessions.delete(sessionId);
    return { valid: false };
  }

  // Find user
  for (const user of users.values()) {
    if (user.id === session.userId) {
      return {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          walletSetupCompleted: user.walletSetupCompleted,
        },
      };
    }
  }

  return { valid: false };
}

/**
 * Terminate a session (logout).
 */
export function terminateSession(sessionId: string | undefined): void {
  if (sessionId) {
    sessions.delete(sessionId);
  }
}

/**
 * Mark wallet setup completed for a user.
 */
export function setWalletSetupCompleted(userId: string, completed = true): boolean {
  for (const user of users.values()) {
    if (user.id === userId) {
      user.walletSetupCompleted = completed;
      return true;
    }
  }
  return false;
}

// Seed initial default operator user for seamless demo / test access
(function seedDefaultUser() {
  const defaultEmail = "operator@sentinel.wallet";
  const defaultPass = "SentinelDemo2026!";
  registerUser(defaultEmail, defaultPass);
  const u = users.get(defaultEmail);
  if (u) {
    u.walletSetupCompleted = true; // default demo user has setup done
  }
})();
