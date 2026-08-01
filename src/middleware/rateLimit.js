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
