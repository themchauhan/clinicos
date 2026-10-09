// sharp and Buffer misbehave under vitest's default jsdom environment
// (cross-realm Uint8Array), and nothing here touches the DOM.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  mergeIdSides,
  optimizeDocumentFile,
  optimizeIdSides,
  optimizeStampImage,
} from "./optimize-image";

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

describe("mergeIdSides / optimizeIdSides", () => {
  const solid = (width: number, height: number, colour: string) =>
    sharp({ create: { width, height, channels: 3, background: colour } })
      .jpeg({ quality: 95 })
      .toBuffer();

  /** Average colour of a horizontal band of the image. (stats() ignores a
   * preceding extract(), so the band is cut out to its own buffer first.) */
  async function bandColour(image: Buffer, top: number, height: number) {
    const meta = await sharp(image).metadata();
    const band = await sharp(image)
      .extract({ left: 10, top, width: meta.width! - 20, height })
      .toBuffer();
    const stats = await sharp(band).stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    return { r, g, b };
  }

  it("stacks the front above the back in one JPEG, brought to the same width", async () => {
    const front = await solid(1200, 760, "#cc2222"); // red front
    const back = await solid(900, 600, "#2222cc"); // blue back, narrower
    const out = await mergeIdSides(front, back);

    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
    const meta = await sharp(out.buffer).metadata();
    // The narrower photo sets the width (no enlargement).
    expect(meta.width).toBe(900);
    // front scaled to 900 wide (760 * 900/1200 = 570) + gap 32 + back 600
    expect(meta.height).toBe(570 + 32 + 600);

    const top = await bandColour(out.buffer, 20, 200);
    const bottom = await bandColour(out.buffer, 570 + 32 + 50, 200);
    expect(top.r).toBeGreaterThan(top.b + 80); // red on top
    expect(bottom.b).toBeGreaterThan(bottom.r + 80); // blue below
  });

  it("caps the merged width so big phone photos don't make a huge image", async () => {
    const out = await mergeIdSides(
      await solid(4000, 2600, "#888888"),
      await solid(4000, 2600, "#777777"),
    );
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1040 + 32 + 1040);
  });

  it("applies EXIF orientation to each side before stacking and drops metadata", async () => {
    const sideways = await sharp({
      create: { width: 800, height: 500, channels: 3, background: "#cc2222" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 }) // displays rotated 90deg: 500 wide x 800 tall
      .toBuffer();
    const out = await mergeIdSides(sideways, sideways);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(800 + 32 + 800);
    expect(meta.exif).toBeUndefined();
  });

  it("optimizeIdSides: both -> merged, one -> that side alone, none -> null", async () => {
    const a = await solid(1000, 650, "#cc2222");
    const b = await solid(1000, 650, "#2222cc");

    const both = await optimizeIdSides({ front: a, back: b });
    expect(both?.label).toBe("front + back");
    expect((await sharp(both!.buffer).metadata()).height).toBe(650 + 32 + 650);

    const frontOnly = await optimizeIdSides({ front: a });
    expect(frontOnly?.label).toBe("front");
    expect((await sharp(frontOnly!.buffer).metadata()).height).toBe(650);

    const backOnly = await optimizeIdSides({ back: b });
    expect(backOnly?.label).toBe("back");

    expect(await optimizeIdSides({})).toBeNull();
  });
});
