import './helpers/setup';
import { describe, it, expect } from 'vitest';
import { validateBase64Upload } from '../src/lib/upload-validation';
import { ApiError } from '../src/middlewares/errorHandler';

// Build a Buffer that starts with the given magic bytes and is padded
// with zeros to reach `totalSize` bytes total.
function buildFile(magic: number[], totalSize: number): Buffer {
  const buf = Buffer.alloc(Math.max(totalSize, magic.length));
  for (let i = 0; i < magic.length; i++) buf[i] = magic[i];
  return buf;
}

function toB64(buf: Buffer): string {
  return buf.toString('base64');
}

describe('validateBase64Upload', () => {
  it('accepts a valid PNG', () => {
    const png = buildFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64);
    const result = validateBase64Upload(toB64(png));
    expect(result.mime).toBe('image/png');
    expect(result.size).toBe(64);
  });

  it('accepts a valid JPEG', () => {
    const jpeg = buildFile([0xff, 0xd8, 0xff, 0xe0], 64);
    const result = validateBase64Upload(toB64(jpeg));
    expect(result.mime).toBe('image/jpeg');
  });

  it('accepts a valid PDF', () => {
    const pdf = buildFile([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], 128);
    const result = validateBase64Upload(toB64(pdf));
    expect(result.mime).toBe('application/pdf');
  });

  it('accepts a valid WEBP (RIFF + WEBP marker)', () => {
    const webp = Buffer.alloc(32);
    // "RIFF" size "WEBP"
    webp[0] = 0x52; webp[1] = 0x49; webp[2] = 0x46; webp[3] = 0x46;
    webp[4] = 0x10; webp[5] = 0x00; webp[6] = 0x00; webp[7] = 0x00;
    webp[8] = 0x57; webp[9] = 0x45; webp[10] = 0x42; webp[11] = 0x50;
    const result = validateBase64Upload(toB64(webp));
    expect(result.mime).toBe('image/webp');
  });

  it('rejects random bytes as unknown file type', () => {
    const junk = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]);
    expect(() => validateBase64Upload(toB64(junk))).toThrow(ApiError);
    try {
      validateBase64Upload(toB64(junk));
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError);
      expect(e.message).toMatch(/Unknown file type/);
    }
  });

  it('rejects a RIFF file that is not actually WEBP', () => {
    // RIFF header with WAVE marker instead of WEBP
    const wav = Buffer.alloc(32);
    wav[0] = 0x52; wav[1] = 0x49; wav[2] = 0x46; wav[3] = 0x46;
    wav[8] = 0x57; wav[9] = 0x41; wav[10] = 0x56; wav[11] = 0x45;
    expect(() => validateBase64Upload(toB64(wav))).toThrow(/Unknown file type/);
  });

  it('rejects files larger than the default 5MB cap', () => {
    const big = buildFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 5 * 1024 * 1024 + 10);
    expect(() => validateBase64Upload(toB64(big))).toThrow(/File too large/);
  });

  it('rejects files larger than a custom maxSize', () => {
    const png = buildFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 2048);
    expect(() =>
      validateBase64Upload(toB64(png), { maxSize: 1024 })
    ).toThrow(/File too large/);
  });

  it('rejects files smaller than 8 bytes', () => {
    const tiny = Buffer.from([0xff, 0xd8, 0xff]);
    expect(() => validateBase64Upload(toB64(tiny))).toThrow(/too small/);
  });

  it('rejects invalid base64 data', () => {
    expect(() => validateBase64Upload('!!!not base64***')).toThrow(/Invalid base64/);
  });

  it('rejects empty strings', () => {
    expect(() => validateBase64Upload('')).toThrow(/Invalid base64/);
  });

  it('rejects MIME types not in allowedMimes', () => {
    const pdf = buildFile([0x25, 0x50, 0x44, 0x46, 0x2d], 128);
    expect(() =>
      validateBase64Upload(toB64(pdf), { allowedMimes: ['image/png'] })
    ).toThrow(/not allowed/);
  });

  it('strips data URI prefix before decoding', () => {
    const png = buildFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64);
    const dataUri = `data:image/png;base64,${toB64(png)}`;
    const result = validateBase64Upload(dataUri);
    expect(result.mime).toBe('image/png');
  });

  it('rejects a file that claims PDF mime but has PNG bytes', () => {
    // The whole point of magic-byte detection: client lies, we catch it.
    const png = buildFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64);
    expect(() =>
      validateBase64Upload(toB64(png), { allowedMimes: ['application/pdf'] })
    ).toThrow(/not allowed/);
  });
});
