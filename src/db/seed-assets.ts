/**
 * Placeholder files for the seeded world.
 *
 * The admin verification screen is only worth looking at if there is something
 * to look at, so the seed writes real bytes into the object store rather than
 * inventing keys that point at nothing: a one-page PDF per credential, and a
 * solid-colour PNG per avatar.
 *
 * Both are generated rather than checked in, so the repository stays free of
 * binary fixtures.
 */

import { crc32, deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData) >>> 0);

  return Buffer.concat([length, typeAndData, checksum]);
}

/** A solid-colour truecolour PNG. Enough to stand in for a profile photo. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is a filter byte (0 = none) followed by RGB triples.
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = rgb[0];
      raw[pixel + 1] = rgb[1];
      raw[pixel + 2] = rgb[2];
    }
  }

  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** A stable colour per id, so a tutor's avatar does not change between seeds. */
export function colourFor(id: string): [number, number, number] {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  // Kept in the mid range so white text would be readable over it.
  return [90 + (hash % 120), 90 + ((hash >> 8) % 120), 90 + ((hash >> 16) % 120)];
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, (match) => `\\${match}`).replace(/[^\x20-\x7e]/g, '');
}

/**
 * A minimal, valid single-page PDF with a few lines of Helvetica.
 *
 * Written by hand rather than with a library because the seed needs exactly
 * this and nothing more, and a real PDF makes the review screen behave the way
 * it will in production.
 */
export function simplePdf(lines: string[]): Uint8Array {
  const content = [
    'BT',
    '/F1 20 Tf',
    '72 760 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? '' : '0 -28 Td',
      `(${escapePdfText(line)}) Tj`,
    ]),
    'ET',
  ]
    .filter(Boolean)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = header.length + body.length;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  ].join('\n');

  const trailer = `\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(header + body + xref + trailer, 'latin1'));
}
