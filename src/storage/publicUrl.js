import { storageConfig } from './config.js';
import { toPublicUrl as toPublicUrlPure } from './refs.js';
import { currentPublicBase } from './requestContext.js';

/**
 * Public URL for a stored image value, for the current request's client.
 * Synchronous and dependency-light on purpose: model getters call it while
 * responses are serialised.
 */
export function toPublicUrl(value) {
  const { publicBucket } = storageConfig();
  return toPublicUrlPure(value, { publicBase: currentPublicBase(), publicBucket });
}
