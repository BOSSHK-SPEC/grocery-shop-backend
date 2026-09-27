import { Client } from 'minio';
import { storageConfig } from './config.js';

let internal = null;

/**
 * Client the server uses for its own storage calls (stat, read, write,
 * delete), addressed over the internal endpoint.
 */
export function internalClient() {
  if (internal) return internal;
  const config = storageConfig();
  internal = new Client({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    pathStyle: true,
  });
  return internal;
}

const signers = new Map();
const MAX_SIGNERS = 16;

/**
 * Client used only to *sign* links handed to phones. A presigned GET embeds
 * the host it was signed for, so it must be signed with the address the phone
 * will actually use — not the internal endpoint. Signing is purely local (the
 * region is fixed in config), so the server never needs to reach this host.
 */
export function signingClient(publicBase) {
  const url = new URL(publicBase);
  const cacheKey = url.origin;
  const existing = signers.get(cacheKey);
  if (existing) return existing;

  const config = storageConfig();
  const useSSL = url.protocol === 'https:';
  const client = new Client({
    endPoint: url.hostname,
    port: url.port ? parseInt(url.port, 10) : useSSL ? 443 : 80,
    useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    pathStyle: true,
  });
  // Bounded: in local dev the base follows the request host.
  if (signers.size >= MAX_SIGNERS) signers.clear();
  signers.set(cacheKey, client);
  return client;
}
