// sharp and Buffer misbehave under vitest's default jsdom environment
// (cross-realm Uint8Array), and nothing here touches the DOM.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeDocumentFile, optimizeStampImage } from "./optimize-image";

/** A noisy 4000x3000 image: stands in for a 12MP phone photo, and noise
 * doesn't compress, so it is a worst case for file size. */
async function makePhoto(opts: { format: "jpeg" | "png"; orientation?: number }) {
  const noise = Buffer.alloc(4000 * 3000 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  let img = sharp(noise, { raw: { width: 4000, height: 3000, channels: 3 } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return opts.format === "jpeg"
    ? img.jpeg({ quality: 92 }).toBuffer()
    : img.png({ compressionLevel: 1 }).toBuffer();
}

describe("optimizeDocumentFile", () => {
  it("bounds a large JPEG to 2000px and makes it much smaller", async () => {
    const photo = await makePhoto({ format: "jpeg" });
    const out = await optimizeDocumentFile(photo, "image/jpeg");

    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    expect(out.buffer.byteLength).toBeLessThan(photo.byteLength / 2);
  });

  it("stores a PNG photo as JPEG", async () => {
    const png = await makePhoto({ format: "png" });
    const out = await optimizeDocumentFile(png, "image/png");

    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
    expect((await sharp(out.buffer).metadata()).format).toBe("jpeg");
    expect(out.buffer.byteLength).toBeLessThan(png.byteLength / 4);
  });

  it("applies the EXIF orientation, then drops all metadata (incl. GPS-capable EXIF)", async () => {
    // Orientation 6 = rotate 90deg: a 4000x3000 landscape file displays portrait.
    const photo = await makePhoto({ format: "jpeg", orientation: 6 });
    const out = await optimizeDocumentFile(photo, "image/jpeg");

    const meta = await sharp(out.buffer).metadata();
    expect(meta.height!).toBeGreaterThan(meta.width!); // displayed upright
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("does not enlarge a small image", async () => {
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();
    const out = await optimizeDocumentFile(small, "image/jpeg");
    const meta = await sharp(out.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("passes a PDF through unchanged", async () => {
    const pdf = Buffer.from("%PDF-1.4 test");
    const out = await optimizeDocumentFile(pdf, "application/pdf");
    expect(out.buffer).toBe(pdf);
    expect(out.ext).toBe("pdf");
  });
});

describe("optimizeStampImage", () => {
  it("keeps a PNG's transparency while shrinking it to a palette", async () => {
    const stroke = await sharp({
      create: { width: 1600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 800, height: 40, channels: 4, background: "#10206080" },
          })
            .png()
            .toBuffer(),
          left: 200,
          top: 280,
        },
      ])
      .png({ compressionLevel: 0 })
      .toBuffer();

    const out = await optimizeStampImage(stroke);
    expect(out.mime).toBe("image/png");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(800);
    expect(out.buffer.byteLength).toBeLessThan(stroke.byteLength / 4);
  });

  it("keeps a JPEG as a JPEG", async () => {
    const jpeg = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    const out = await optimizeStampImage(jpeg);
    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
  });
});
