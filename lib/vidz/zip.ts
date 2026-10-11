// COPIED VERBATIM from vidzart-app/src/lib/vidz/zip.ts (the repos are
// independent, so they can't share a package). Keep the two in sync: diff
// them when changing either. Double quotes are kept on purpose so the diff
// stays empty.

// A minimal zip reader/writer, just enough for .vidz files.
//
// Why not a library? Two .vidz-specific wins:
//   1. Reading: the video entry is stored uncompressed (spec), so its bytes
//      sit contiguously in the file. We return `file.slice(start, end)`, a
//      zero-copy view, instead of loading a possibly multi-GB video into
//      memory.
//   2. Compression uses the browser's built-in CompressionStream /
//      DecompressionStream ("deflate-raw" is exactly zip's DEFLATE).
//
// Zip layout (all integers little-endian):
//
//   [local header + name][data]   ← one per entry
//   [local header + name][data]
//   [central directory header + name]  ← one per entry, points back to the
//   [central directory header + name]     local header via its offset
//   [end of central directory]    ← found by scanning back from the end
//
// Limits: no Zip64, so the archive and every entry must stay under 4 GiB;
// no encryption; only STORE (0) and DEFLATE (8) methods.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_UTF8 = 1 << 11; // file names are UTF-8
const MAX_U32 = 0xffff_ffff;

export interface ZipInput {
  name: string;
  data: Blob;
  /** Deflate this entry? Use for text/JSON; never for video (already compressed). */
  compress?: boolean;
}

export interface ZipEntry {
  name: string;
  size: number;
  /** Reads the entry's (uncompressed) contents. */
  blob(): Promise<Blob>;
  text(): Promise<string>;
}

// --- CRC-32 -----------------------------------------------------------------
// Zip stores a checksum of each entry's uncompressed bytes. Standard
// table-driven CRC-32 (polynomial 0xEDB88320).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc ^ MAX_U32;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ MAX_U32) >>> 0;
}

/** CRC-32 of a Blob, read in chunks so large videos don't need to fit in memory. */
async function crc32OfBlob(blob: Blob): Promise<number> {
  let crc = 0;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32Update(crc, value);
  }
}

async function deflateRaw(blob: Blob): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Response(stream).blob();
}

async function inflateRaw(blob: Blob): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).blob();
}

// --- writing ------------------------------------------------------------------

/** MS-DOS date/time, the format zip uses for modification times. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function writeZip(inputs: readonly ZipInput[], now = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const parts: BlobPart[] = [];
  // <ArrayBuffer>: Blob parts must not be SharedArrayBuffer-backed views.
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const input of inputs) {
    const name = encoder.encode(input.name);
    const crc = await crc32OfBlob(input.data);
    const method = input.compress ? METHOD_DEFLATE : METHOD_STORE;
    const data = input.compress ? await deflateRaw(input.data) : input.data;
    if (input.data.size > MAX_U32 || offset + data.size > MAX_U32) {
      throw new Error("Project is larger than 4 GB, which .vidz doesn't support yet.");
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true);
    local.setUint16(4, 20, true); // version needed to extract (2.0)
    local.setUint16(6, FLAG_UTF8, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.size, true); // compressed size
    local.setUint32(22, input.data.size, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length
    parts.push(local.buffer, name, data);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, SIG_CENTRAL, true);
    header.setUint16(4, 20, true); // version made by
    header.setUint16(6, 20, true); // version needed
    header.setUint16(8, FLAG_UTF8, true);
    header.setUint16(10, method, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, data.size, true);
    header.setUint32(24, input.data.size, true);
    header.setUint16(28, name.length, true);
    // 30 extra len, 32 comment len, 34 disk, 36 internal attrs, 38 external attrs: all 0
    header.setUint32(42, offset, true); // where the local header starts
    central.push(new Uint8Array(header.buffer), name);

    offset += 30 + name.length + data.size;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, SIG_EOCD, true);
  eocd.setUint16(8, inputs.length, true); // entries on this disk
  eocd.setUint16(10, inputs.length, true); // entries total
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true); // where the central directory starts

  return new Blob([...parts, ...central, eocd.buffer], { type: "application/zip" });
}

// --- reading ------------------------------------------------------------------

export class ZipError extends Error {}

async function readView(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** Lists a zip's entries. Entry contents are only read when you ask for them. */
export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  // The end-of-central-directory record is the last 22 bytes, unless the
  // archive has a comment (up to 64 KiB) after it, so scan backwards.
  const tailStart = Math.max(0, file.size - (22 + 0xffff));
  const tail = await readView(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Not a zip file.");

  const count = tail.getUint16(eocd + 10, true);
  const centralSize = tail.getUint32(eocd + 12, true);
  const centralOffset = tail.getUint32(eocd + 16, true);
  if (centralOffset === MAX_U32) throw new ZipError("Zip64 archives aren't supported.");
  const dir = await readView(file, centralOffset, centralOffset + centralSize);
  const decoder = new TextDecoder();

  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (dir.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError("Corrupt zip directory.");
    const method = dir.getUint16(p + 10, true);
    const compressedSize = dir.getUint32(p + 20, true);
    const size = dir.getUint32(p + 24, true);
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    const commentLength = dir.getUint16(p + 32, true);
    const localOffset = dir.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength));
    p += 46 + nameLength + extraLength + commentLength;

    const blob = async (): Promise<Blob> => {
      // The local header's name/extra lengths can differ from the central
      // directory's, so read them to find where the data starts.
      const local = await readView(file, localOffset, localOffset + 30);
      if (local.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`Corrupt entry: ${name}`);
      const dataStart = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const raw = file.slice(dataStart, dataStart + compressedSize); // zero-copy view
      if (method === METHOD_STORE) return raw;
      if (method === METHOD_DEFLATE) return inflateRaw(raw);
      throw new ZipError(`Unsupported compression in ${name}.`);
    };
    entries.set(name, { name, size, blob, text: async () => (await blob()).text() });
  }
  return entries;
}
