import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { RefreshToken } from '../models/index.js';

// Secrets are read lazily (inside functions) because ES module imports are
// evaluated before app.js runs dotenv.config(); reading at top-level would see
// undefined. No hardcoded fallback — a missing secret fails fast.
function accessSecret() {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET (or JWT_SECRET) is not set. Refusing to sign/verify tokens.');
  }
  return secret;
}

function accessTtl() {
  return process.env.ACCESS_TOKEN_TTL || '15m';
}

function refreshTtlMs() {
  const days = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);
  return days * 24 * 60 * 60 * 1000;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function signAccessToken(payload, options = {}) {
  return jwt.sign(payload, accessSecret(), { expiresIn: accessTtl(), ...options });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret());
}

// Issue a new opaque refresh token and persist only its hash.
export async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  await RefreshToken.create({ userId, tokenHash: hashToken(raw), expiresAt });
  return { token: raw, expiresAt };
}

/**
 * Rotate a refresh token: validate, revoke the old row, issue a new one.
 * Detects reuse of an already-rotated/revoked token and, as a theft response,
 * revokes every active refresh token for that user.
 * Returns { userId, refreshToken, expiresAt } or throws an Error with .code.
 */
export async function rotateRefreshToken(rawToken) {
  if (!rawToken) {
    const e = new Error('Refresh token required.');
    e.code = 'NO_TOKEN';
    throw e;
  }
  const tokenHash = hashToken(rawToken);
  const existing = await RefreshToken.findOne({ where: { tokenHash } });
  if (!existing) {
    const e = new Error('Invalid refresh token.');
    e.code = 'INVALID';
    throw e;
  }
  if (existing.revoked) {
    // Reuse of a revoked token → likely theft. Revoke all of the user's tokens.
    await RefreshToken.update({ revoked: true }, { where: { userId: existing.userId, revoked: false } });
    const e = new Error('Refresh token has already been used.');
    e.code = 'REUSED';
    throw e;
  }
  if (new Date(existing.expiresAt).getTime() < Date.now()) {
    const e = new Error('Refresh token expired.');
    e.code = 'EXPIRED';
    throw e;
  }

  const next = await issueRefreshToken(existing.userId);
  await existing.update({ revoked: true, replacedByHash: hashToken(next.token) });
  return { userId: existing.userId, refreshToken: next.token, expiresAt: next.expiresAt };
}

// Revoke a single refresh token (logout on one device). Never throws.
export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  try {
    const tokenHash = hashToken(rawToken);
    await RefreshToken.update({ revoked: true }, { where: { tokenHash } });
  } catch (err) {
    console.error('revokeRefreshToken failed:', err.message);
  }
}

// Revoke every refresh token for a user (logout everywhere). Never throws.
export async function revokeAllForUser(userId) {
  try {
    await RefreshToken.update({ revoked: true }, { where: { userId, revoked: false } });
  } catch (err) {
    console.error('revokeAllForUser failed:', err.message);
  }
}
