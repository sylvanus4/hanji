/**
 * Minimal ZIP writer, stored (uncompressed) entries only.
 *
 * Page exports produce one file per page, and handing someone thirty separate
 * downloads is hostile — browsers block the burst anyway. So multi-file results
 * are zipped.
 *
 * Deflate is deliberately absent. Everything we put in these archives is PNG or
 * JPEG, which is already compressed; running deflate over it would burn CPU to
 * save roughly nothing. Storing also means no dependency and no WASM.
 */

import { S, t } from "../i18n";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 11: filenames are UTF-8. Korean filenames are the normal case here. */
const FLAG_UTF8 = 0x0800;
/** ZIP's 32-bit size fields; beyond this we would need ZIP64. */
const MAX_TOTAL = 0xffffffff;

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  table = t;
  return t;
}

function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Staged {
  // Pinned to ArrayBuffer rather than the default ArrayBufferLike: a
  // SharedArrayBuffer-backed view is not a valid BlobPart, and this page is
  // cross-origin isolated, so that distinction is live rather than theoretical.
  nameBytes: Uint8Array<ArrayBuffer>;
  data: Uint8Array<ArrayBuffer>;
  crc: number;
  offset: number;
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/**
 * Build a ZIP archive from the given entries.
 *
 * Timestamps are fixed rather than taken from the clock so the same input
 * produces the same bytes — which is what lets a test assert on output at all.
 */
export async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const staged: Staged[] = [];
  const parts: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(data);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, LOCAL_SIG, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, FLAG_UTF8, true);
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, 0, true); // fixed time
    header.setUint16(12, 0x0021, true); // fixed date: 1980-01-01
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // no extra field

    parts.push(header.buffer, nameBytes, data);
    staged.push({ nameBytes, data, crc, offset });
    offset += 30 + nameBytes.length + data.length;

    if (offset > MAX_TOTAL) {
      throw new Error(t(S.zipTooBig));
    }
  }

  const centralStart = offset;

  for (const item of staged) {
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, CENTRAL_SIG, true);
    record.setUint16(4, 20, true); // version made by
    record.setUint16(6, 20, true); // version needed
    record.setUint16(8, FLAG_UTF8, true);
    record.setUint16(10, 0, true); // stored
    record.setUint16(12, 0, true);
    record.setUint16(14, 0x0021, true);
    record.setUint32(16, item.crc, true);
    record.setUint32(20, item.data.length, true);
    record.setUint32(24, item.data.length, true);
    record.setUint16(28, item.nameBytes.length, true);
    record.setUint16(30, 0, true); // extra
    record.setUint16(32, 0, true); // comment
    record.setUint16(34, 0, true); // disk
    record.setUint16(36, 0, true); // internal attrs
    record.setUint32(38, 0, true); // external attrs
    record.setUint32(42, item.offset, true);

    parts.push(record.buffer, item.nameBytes);
    offset += 46 + item.nameBytes.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_SIG, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, staged.length, true);
  eocd.setUint16(10, staged.length, true);
  eocd.setUint32(12, offset - centralStart, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);
  parts.push(eocd.buffer);

  return new Blob(parts, { type: "application/zip" });
}
