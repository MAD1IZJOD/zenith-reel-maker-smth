import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import zlib from "node:zlib";

/**
 * Minimal streaming ZIP (store method). MP4s are already compressed, so files are stored as-is. Each file is read
 * once for its CRC-32 and once to stream, so memory use stays flat regardless of reel sizes. Archives stay far below
 * the 4 GB ZIP32 limits (three short reels).
 */
const TABLE = (() => { const table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; } return table; })();
function crc32Update(crc: number, chunk: Buffer): number {
  const native = (zlib as unknown as { crc32?: (data: Buffer, value?: number) => number }).crc32;
  if (native) return native(chunk, crc);
  let c = ~crc;
  for (let i = 0; i < chunk.length; i++) c = TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
async function fileCrc(file: string): Promise<number> { let crc = 0; for await (const chunk of createReadStream(file)) crc = crc32Update(crc, chunk as Buffer); return crc >>> 0; }

const dosTime = (date: Date) => ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
const dosDate = (date: Date) => (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

export async function zipStream(entries: { name: string; file: string }[]): Promise<ReadableStream<Uint8Array>> {
  const now = new Date();
  const prepared = await Promise.all(entries.map(async (entry) => ({ ...entry, name: Buffer.from(entry.name.replace(/[^a-zA-Z0-9._-]/g, "-"), "utf8"), size: (await stat(entry.file)).size, crc: await fileCrc(entry.file) })));
  if (prepared.some((entry) => entry.size >= 0xffffffff)) throw new Error("File too large for ZIP32.");
  async function* generate() {
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of prepared) {
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
      local.writeUInt16LE(dosTime(now), 10); local.writeUInt16LE(dosDate(now), 12); local.writeUInt32LE(entry.crc, 14);
      local.writeUInt32LE(entry.size, 18); local.writeUInt32LE(entry.size, 22); local.writeUInt16LE(entry.name.length, 26); local.writeUInt16LE(0, 28);
      yield local; yield entry.name;
      for await (const chunk of createReadStream(entry.file)) yield chunk as Buffer;
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(0, 10);
      record.writeUInt16LE(dosTime(now), 12); record.writeUInt16LE(dosDate(now), 14); record.writeUInt32LE(entry.crc, 16); record.writeUInt32LE(entry.size, 20); record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28); record.writeUInt16LE(0, 30); record.writeUInt16LE(0, 32); record.writeUInt16LE(0, 34); record.writeUInt16LE(0, 36); record.writeUInt32LE(0, 38); record.writeUInt32LE(offset, 42);
      central.push(Buffer.concat([record, entry.name]));
      offset += 30 + entry.name.length + entry.size;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(prepared.length, 8); end.writeUInt16LE(prepared.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    yield directory; yield end;
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) { const { value, done } = await iterator.next(); if (done) controller.close(); else controller.enqueue(new Uint8Array(value)); },
    async cancel() { await iterator.return(undefined); },
  });
}
