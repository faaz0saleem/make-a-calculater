import { describe, expect, it } from 'vitest';

import { colourFor, simplePdf, solidPng } from './seed-assets';

describe('solidPng', () => {
  it('starts with the PNG signature and ends with IEND', () => {
    const png = Buffer.from(solidPng(8, 8, [10, 20, 30]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
  });

  it('declares the size it was asked for', () => {
    const png = Buffer.from(solidPng(64, 32, [1, 2, 3]));
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it('passes the same check the upload validator applies', async () => {
    const { checkUpload } = await import('@/lib/storage/uploads');
    const png = solidPng(16, 16, [5, 5, 5]);
    expect(checkUpload('avatar', { size: png.byteLength, type: 'image/png' }, png.subarray(0, 16)).ok).toBe(
      true,
    );
  });
});

describe('colourFor', () => {
  it('is stable for the same id and different across ids', () => {
    expect(colourFor('abc')).toEqual(colourFor('abc'));
    expect(colourFor('abc')).not.toEqual(colourFor('abd'));
  });

  it('stays in the mid range', () => {
    for (const id of ['a', 'bb', 'ccc', 'tutor-42']) {
      for (const channel of colourFor(id)) {
        expect(channel).toBeGreaterThanOrEqual(90);
        expect(channel).toBeLessThan(210);
      }
    }
  });
});

describe('simplePdf', () => {
  it('produces something a PDF reader will open', () => {
    const pdf = Buffer.from(simplePdf(['BSc Mathematics', 'University of Punjab', '2016']));
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('startxref');
    expect(pdf.subarray(-6).toString('latin1').trim()).toBe('%%EOF');
  });

  it('includes the text it was given', () => {
    expect(Buffer.from(simplePdf(['Hello there'])).toString('latin1')).toContain('(Hello there) Tj');
  });

  it('escapes characters that would break the content stream', () => {
    const text = Buffer.from(simplePdf(['A (tricky) \\ one'])).toString('latin1');
    expect(text).toContain('\\(tricky\\)');
    expect(text).not.toContain('(A (tricky)');
  });

  it('passes the credential upload check', async () => {
    const { checkUpload } = await import('@/lib/storage/uploads');
    const pdf = simplePdf(['x']);
    expect(checkUpload('credential', { size: pdf.byteLength, type: 'application/pdf' }, pdf.subarray(0, 16)).ok).toBe(
      true,
    );
  });
});
