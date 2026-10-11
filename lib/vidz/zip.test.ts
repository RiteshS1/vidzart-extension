import { describe, expect, it } from "vitest";
import { crc32Update, readZip, writeZip, ZipError } from "./zip";

describe("crc32", () => {
  it("matches the standard check value", () => {
    // The CRC-32 of "123456789" is 0xCBF43926 by definition.
    expect(crc32Update(0, new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("zip round trip", () => {
  it("writes and reads stored and deflated entries", async () => {
    const video = new Blob([new Uint8Array(100_000).map((_, i) => i % 251)]);
    const json = new Blob([JSON.stringify({ hello: "world".repeat(100) })]);
    const zip = await writeZip([
      { name: "manifest.json", data: json, compress: true },
      { name: "video.webm", data: video },
    ]);

    const entries = await readZip(zip);
    expect([...entries.keys()]).toEqual(["manifest.json", "video.webm"]);
    expect(JSON.parse(await entries.get("manifest.json")!.text())).toEqual({ hello: "world".repeat(100) });

    const read = await entries.get("video.webm")!.blob();
    expect(read.size).toBe(100_000);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array(await video.arrayBuffer()));
  });

  it("deflates JSON but stores the video uncompressed", async () => {
    const json = new Blob(["a".repeat(10_000)]);
    const zip = await writeZip([{ name: "big.json", data: json, compress: true }]);
    expect(zip.size).toBeLessThan(1_000);
  });

  it("handles UTF-8 names", async () => {
    const zip = await writeZip([{ name: "assets/fondo-ñ.png", data: new Blob(["x"]) }]);
    expect([...(await readZip(zip)).keys()]).toEqual(["assets/fondo-ñ.png"]);
  });

  it("rejects non-zip data", async () => {
    await expect(readZip(new Blob(["definitely not a zip file"]))).rejects.toBeInstanceOf(ZipError);
  });
});
