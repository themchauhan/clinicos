// Real File/Blob and sharp buffers are used; keep out of jsdom (cross-realm
// Uint8Array problems) -- nothing here touches the DOM.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareUploadFromForm, safeFileLabel } from "./prepare-upload";

const jpeg = (w: number, h: number, colour: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();

const fileOf = (data: Buffer | string, name: string, type: string) =>
  new File([typeof data === "string" ? Buffer.from(data) : new Uint8Array(data)], name, { type });

const PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";
const idType = { name: "ID Proof", two_sided: true };
const plainType = { name: "USG Report", two_sided: false };

describe("prepareUploadFromForm: ordinary types", () => {
  it("takes the single file, keeping its name (extension follows an image's new format)", async () => {
    const fd = new FormData();
    fd.set("file", fileOf(await jpeg(800, 600, "#888888"), "scan.jpeg", "image/jpeg"));
    const out = await prepareUploadFromForm(fd, plainType);
    expect(out).toMatchObject({ fileName: "scan.jpeg" });

    const png = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const fd2 = new FormData();
    fd2.set("file", fileOf(png, "shot.png", "image/png"));
    expect(await prepareUploadFromForm(fd2, plainType)).toMatchObject({ fileName: "shot.jpg" });
  });

  it("asks for a file when none is sent, and rejects a non-image/PDF by its bytes", async () => {
    expect(await prepareUploadFromForm(new FormData(), plainType)).toEqual({
      error: "Choose a file to upload.",
    });
    const fd = new FormData();
    fd.set("file", fileOf("just some text", "evil.jpg", "image/jpeg")); // lying name and type
    const out = await prepareUploadFromForm(fd, plainType);
    expect("error" in out).toBe(true);
  });
});

describe("prepareUploadFromForm: two-sided ID types", () => {
  it("merges front and back into one image named for both sides", async () => {
    const fd = new FormData();
    fd.set("front", fileOf(await jpeg(1000, 650, "#cc2222"), "f.jpg", "image/jpeg"));
    fd.set("back", fileOf(await jpeg(1000, 650, "#2222cc"), "b.jpg", "image/jpeg"));
    const out = await prepareUploadFromForm(fd, idType);
    if ("error" in out) throw new Error(out.error);

    expect(out.fileName).toBe("ID Proof (front + back).jpg");
    expect(out.stored.mime).toBe("image/jpeg");
    const meta = await sharp(out.stored.buffer).metadata();
    expect(meta.height).toBe(650 + 32 + 650);
  });

  it("stores one side on its own when only that side is given", async () => {
    const front = new FormData();
    front.set("front", fileOf(await jpeg(1000, 650, "#cc2222"), "f.jpg", "image/jpeg"));
    expect(await prepareUploadFromForm(front, idType)).toMatchObject({
      fileName: "ID Proof (front).jpg",
    });

    const back = new FormData();
    back.set("back", fileOf(await jpeg(1000, 650, "#2222cc"), "b.jpg", "image/jpeg"));
    expect(await prepareUploadFromForm(back, idType)).toMatchObject({
      fileName: "ID Proof (back).jpg",
    });
  });

  it("needs at least one side", async () => {
    expect(await prepareUploadFromForm(new FormData(), idType)).toEqual({
      error: "Add the front, the back, or both.",
    });
  });

  it("accepts a PDF only on its own, never combined with another side", async () => {
    const alone = new FormData();
    alone.set("front", fileOf(PDF, "aadhaar.pdf", "application/pdf"));
    const stored = await prepareUploadFromForm(alone, idType);
    expect(stored).toMatchObject({ fileName: "aadhaar.pdf" });
    if (!("error" in stored)) expect(stored.stored.mime).toBe("application/pdf");

    const mixed = new FormData();
    mixed.set("front", fileOf(PDF, "aadhaar.pdf", "application/pdf"));
    mixed.set("back", fileOf(await jpeg(800, 500, "#222222"), "b.jpg", "image/jpeg"));
    const out = await prepareUploadFromForm(mixed, idType);
    expect("error" in out && out.error).toMatch(/PDF can't be combined/);
  });

  it("validates each side by its bytes and names the side that failed", async () => {
    const fd = new FormData();
    fd.set("front", fileOf(await jpeg(800, 500, "#cc2222"), "f.jpg", "image/jpeg"));
    fd.set("back", fileOf("not an image", "b.jpg", "image/jpeg"));
    const out = await prepareUploadFromForm(fd, idType);
    expect("error" in out && out.error).toMatch(/^Back:/);
  });
});

describe("safeFileLabel", () => {
  it("turns a slash into a dash and strips characters file names can't hold", () => {
    expect(safeFileLabel("Guardian / Relative ID Proof")).toBe("Guardian - Relative ID Proof");
    expect(safeFileLabel("ID Proof")).toBe("ID Proof");
    expect(safeFileLabel('Bad:name*?"<>|')).toBe("Badname");
  });
});
