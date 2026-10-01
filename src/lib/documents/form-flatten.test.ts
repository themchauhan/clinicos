// pdf-lib's internal type validators do cross-realm instanceof checks
// that misbehave under vitest's default jsdom environment (Buffer/
// Uint8Array end up from a different realm than pdf-lib expects) --
// this file has no DOM dependency anyway, so run it in plain Node.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { flattenFormTemplate, readPdfPageSize } from "./form-flatten";

async function makeBlankPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([595, 842]); // A4 in points
  }
  return Buffer.from(await doc.save());
}

async function makeSignaturePng(): Promise<Buffer> {
  return sharp({ create: { width: 100, height: 40, channels: 4, background: "#00000000" } })
    .png()
    .toBuffer();
}

async function makeSealJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 80, channels: 3, background: "#ffffff" } })
    .jpeg()
    .toBuffer();
}

describe("readPdfPageSize", () => {
  it("reads the first page's dimensions in PDF points", async () => {
    const blankPdf = await makeBlankPdf();
    const size = await readPdfPageSize(blankPdf);
    expect(size).toEqual({ pageWidth: 595, pageHeight: 842 });
  });
});

describe("flattenFormTemplate", () => {
  it("produces a valid, reloadable PDF with the same page count", async () => {
    const blankPdf = await makeBlankPdf(2);
    const signaturePng = await makeSignaturePng();

    const result = await flattenFormTemplate({
      blankPdf,
      fields: [
        { pageNumber: 1, x: 50, y: 700, fontSize: 12, multiline: false, value: "Jane Doe" },
        {
          pageNumber: 1,
          x: 50,
          y: 650,
          fontSize: 10,
          multiline: true,
          value: "123 Long Street, Some Neighbourhood, A City That Has A Long Name, 400001",
        },
      ],
      signature: { pageNumber: 2, x: 50, y: 100, width: 150, height: 50, signaturePng },
    });

    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(2);
    // Something was actually drawn -- the flattened file is bigger
    // than the blank one it started from.
    expect(result.byteLength).toBeGreaterThan(blankPdf.byteLength);
  });

  it("skips a blank field without throwing", async () => {
    const blankPdf = await makeBlankPdf();
    const signaturePng = await makeSignaturePng();

    const result = await flattenFormTemplate({
      blankPdf,
      fields: [{ pageNumber: 1, x: 50, y: 700, fontSize: 12, multiline: false, value: "   " }],
      signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
    });

    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("ignores a field or signature placed on a page number that doesn't exist", async () => {
    const blankPdf = await makeBlankPdf(1);
    const signaturePng = await makeSignaturePng();

    await expect(
      flattenFormTemplate({
        blankPdf,
        fields: [{ pageNumber: 5, x: 0, y: 0, fontSize: 12, multiline: false, value: "orphaned" }],
        signature: { pageNumber: 5, x: 0, y: 0, width: 10, height: 10, signaturePng },
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("draws an optional PNG seal alongside the mandatory signature", async () => {
    const blankPdf = await makeBlankPdf(1);
    const signaturePng = await makeSignaturePng();
    const sealPng = await makeSignaturePng();

    const withSeal = await flattenFormTemplate({
      blankPdf,
      fields: [],
      signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
      seal: { pageNumber: 1, x: 300, y: 100, width: 60, height: 60, image: sealPng },
    });
    const withoutSeal = await flattenFormTemplate({
      blankPdf,
      fields: [],
      signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
    });

    expect(await PDFDocument.load(withSeal)).toBeTruthy();
    // Drawing a second embedded image makes the file measurably bigger
    // than the signature-only flatten of the same blank PDF.
    expect(withSeal.byteLength).toBeGreaterThan(withoutSeal.byteLength);
  });

  it("detects a JPEG seal by magic bytes rather than assuming PNG", async () => {
    const blankPdf = await makeBlankPdf(1);
    const signaturePng = await makeSignaturePng();
    const sealJpeg = await makeSealJpeg();

    const result = await flattenFormTemplate({
      blankPdf,
      fields: [],
      signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
      seal: { pageNumber: 1, x: 300, y: 100, width: 60, height: 60, image: sealJpeg },
    });

    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("skips the seal gracefully when it's placed on a page number that doesn't exist", async () => {
    const blankPdf = await makeBlankPdf(1);
    const signaturePng = await makeSignaturePng();
    const sealPng = await makeSignaturePng();

    await expect(
      flattenFormTemplate({
        blankPdf,
        fields: [],
        signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
        seal: { pageNumber: 9, x: 0, y: 0, width: 10, height: 10, image: sealPng },
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("draws the patient signature, the hospital seal, and the doctor's own saved signature all at once", async () => {
    const blankPdf = await makeBlankPdf(1);
    const signaturePng = await makeSignaturePng();
    const sealPng = await makeSignaturePng();
    const doctorSignaturePng = await makeSignaturePng();

    const withAllThree = await flattenFormTemplate({
      blankPdf,
      fields: [],
      signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
      seal: { pageNumber: 1, x: 300, y: 100, width: 60, height: 60, image: sealPng },
      doctorSignature: { pageNumber: 1, x: 400, y: 300, width: 160, height: 50, image: doctorSignaturePng },
    });
    const signatureOnly = await flattenFormTemplate({
      blankPdf,
      fields: [],
      signature: { pageNumber: 1, x: 50, y: 100, width: 150, height: 50, signaturePng },
    });

    expect(await PDFDocument.load(withAllThree)).toBeTruthy();
    // Three embedded images makes the file measurably bigger than the
    // signature-only flatten of the same blank PDF.
    expect(withAllThree.byteLength).toBeGreaterThan(signatureOnly.byteLength);
  });
});
