import rateLimit from 'express-rate-limit';

// Guards OTP request/verify and login against brute force / SMS-bombing.
// Keyed by IP; kept generous enough not to block legitimate retries.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please try again later.' } }
});

// Per-phone OTP request throttle: at most OTP_PHONE_MAX requests per
// OTP_PHONE_WINDOW_MS for the same mobile number, regardless of source IP
// (the IP limiter above does not stop a botnet SMS-bombing one number).
// In-memory on purpose — there is no Redis in this deployment and the app
// runs as a single pm2 process. Restarting the server resets the counters,
// which is an acceptable failure mode for a throttle.
const OTP_PHONE_WINDOW_MS = 10 * 60 * 1000;
const OTP_PHONE_MAX = 5;
const otpRequestLog = new Map(); // normalizedMobile -> [timestamps]

const normalizeMobile = (m) => String(m ?? '').replace(/\D/g, '').slice(-15);

function pruneOtpLog(now) {
  for (const [key, stamps] of otpRequestLog) {
    const fresh = stamps.filter((t) => now - t < OTP_PHONE_WINDOW_MS);
    if (fresh.length === 0) otpRequestLog.delete(key);
    else otpRequestLog.set(key, fresh);
  }
}
// Keep the map from growing unbounded between windows.
setInterval(() => pruneOtpLog(Date.now()), OTP_PHONE_WINDOW_MS).unref();

export const otpPhoneLimiter = (req, res, next) => {
  const key = normalizeMobile(req.body?.mobile);
  if (key.length < 10) return next(); // zod in the controller rejects it with a 400
  const now = Date.now();
  const stamps = (otpRequestLog.get(key) || []).filter((t) => now - t < OTP_PHONE_WINDOW_MS);
  if (stamps.length >= OTP_PHONE_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((stamps[0] + OTP_PHONE_WINDOW_MS - now) / 1000));
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      error: {
        message: 'Too many OTP requests for this number. Please try again later.',
        code: 'OTP_RATE_LIMITED',
        retryAfterSeconds
      }
    });
  }
  stamps.push(now);
  otpRequestLog.set(key, stamps);
  return next();
};
