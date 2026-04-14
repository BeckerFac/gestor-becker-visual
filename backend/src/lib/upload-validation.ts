import { ApiError } from '../middlewares/errorHandler';

/**
 * Base64 upload validation (HIGH-5 fix).
 *
 * Decodes a base64 payload, enforces a size budget and verifies the
 * file type by inspecting magic bytes rather than trusting a
 * client-supplied MIME header.
 */

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MIN_SIZE = 8; // need at least enough bytes to match a signature

// Magic numbers (first bytes of each supported file type).
// Values are intentionally minimal — further sub-type detection
// (e.g. WEBP "WEBP" marker at offset 8) is done below when necessary.
const MIME_SIGNATURES: Record<string, number[][]> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF — refined below
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

export interface UploadValidationOptions {
  maxSize?: number;
  allowedMimes?: string[];
}

export interface ValidatedUpload {
  buffer: Buffer;
  mime: string;
  size: number;
}

function matches(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

function detectMime(buffer: Buffer): string | null {
  for (const [mime, sigs] of Object.entries(MIME_SIGNATURES)) {
    for (const sig of sigs) {
      if (matches(buffer, sig)) {
        // RIFF containers can be WEBP, WAV, AVI... confirm WEBP marker.
        if (mime === 'image/webp') {
          if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
            return mime;
          }
          continue;
        }
        return mime;
      }
    }
  }
  return null;
}

/**
 * Validate a base64-encoded upload.
 *
 * @throws ApiError(400) on any validation failure.
 */
export function validateBase64Upload(
  base64: string,
  opts: UploadValidationOptions = {}
): ValidatedUpload {
  const maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
  const allowedMimes =
    opts.allowedMimes ?? [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
    ];

  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new ApiError(400, 'Invalid base64 data');
  }

  // Strip data URI prefix if present.
  const clean = base64.replace(/^data:[^;]+;base64,/, '');

  // Reject characters outside the base64 alphabet.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    throw new ApiError(400, 'Invalid base64 data');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(clean, 'base64');
  } catch {
    throw new ApiError(400, 'Invalid base64 data');
  }

  if (buffer.length < MIN_SIZE) {
    throw new ApiError(400, 'File too small or corrupted');
  }
  if (buffer.length > maxSize) {
    throw new ApiError(
      400,
      `File too large. Max ${Math.round(maxSize / 1024 / 1024)}MB`
    );
  }

  const detectedMime = detectMime(buffer);
  if (!detectedMime) {
    throw new ApiError(
      400,
      'Unknown file type. Allowed: ' + allowedMimes.join(', ')
    );
  }
  if (!allowedMimes.includes(detectedMime)) {
    throw new ApiError(400, `File type ${detectedMime} not allowed`);
  }

  return { buffer, mime: detectedMime, size: buffer.length };
}
