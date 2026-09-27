/**
 * An image/storage failure with an HTTP status the error middleware passes
 * straight through. 4xx means the client sent something unusable and should
 * be told why; 503 means storage itself is unavailable and the request can be
 * retried.
 */
export class StorageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.code = code;
  }
}

export const isClientError = (error) =>
  error instanceof StorageError && error.status >= 400 && error.status < 500;
