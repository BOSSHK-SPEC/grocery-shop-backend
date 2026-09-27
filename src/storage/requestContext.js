import { AsyncLocalStorage } from 'node:async_hooks';
import { storageConfig } from './config.js';

// Carries "which address should image links use for this request" down to
// code with no access to `req` — notably the model getters that turn stored
// references into URLs while a response is being serialised.
const context = new AsyncLocalStorage();

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/** The configured public base, or the internal endpoint as a last resort. */
export function defaultPublicBase() {
  const config = storageConfig();
  if (config.publicUrl) return config.publicUrl;
  const scheme = config.useSSL ? 'https' : 'http';
  return `${scheme}://${config.endpoint}:${config.port}`;
}

/**
 * Local development only: when MINIO_PUBLIC_URL is unset, image links use the
 * host the app called the API on, with MinIO's port. The Android emulator
 * calls 10.0.2.2, a simulator or browser calls localhost, a phone on the LAN
 * calls the laptop's IP — one setting cannot serve all three.
 *
 * Never in production: there MINIO_PUBLIC_URL is required and always wins, so
 * a forged Host header can never steer where a client sends its upload.
 */
export function publicBaseFor(req) {
  const config = storageConfig();
  if (config.publicUrl || config.isProduction) return defaultPublicBase();
  const hostname = req.hostname;
  if (!hostname || !HOSTNAME_RE.test(hostname)) return defaultPublicBase();
  return `${req.protocol === 'https' ? 'https' : 'http'}://${hostname}:${config.port}`;
}

export function storageRequestContext(req, res, next) {
  context.run({ publicBase: publicBaseFor(req) }, next);
}

export function currentPublicBase() {
  return context.getStore()?.publicBase ?? defaultPublicBase();
}
