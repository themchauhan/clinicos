// pdf-lib's internal type validators do cross-realm instanceof checks
// that misbehave under vitest's default jsdom environment (Buffer/
// Uint8Array end up from a different realm than pdf-lib expects) --
// this file has no DOM dependency anyway, so run it in plain Node.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
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
      doctorSignature: {
        pageNumber: 1,
        x: 400,
        y: 300,
        width: 160,
        height: 50,
        image: doctorSignaturePng,
      },
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

  it("adds little to the blank form's size, even for a large uncompressed signature and seal", async () => {
    const blankPdf = await makeBlankPdf();
    // A 1600x600 truecolour PNG with almost nothing in it -- what a
    // phone's high-DPI signature pad exports -- and a big seal photo.
    const bigSignature = await sharp({
      create: { width: 1600, height: 600, channels: 4, background: "#00000000" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const bigSeal = await sharp({
      create: { width: 3000, height: 3000, channels: 3, background: "#cccccc" },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await flattenFormTemplate({
      blankPdf,
      fields: [{ pageNumber: 1, x: 50, y: 700, fontSize: 12, multiline: false, value: "Jane Doe" }],
      signature: {
        pageNumber: 1,
        x: 50,
        y: 100,
        width: 150,
        height: 50,
        signaturePng: bigSignature,
      },
      seal: { pageNumber: 1, x: 300, y: 100, width: 80, height: 80, image: bigSeal },
    });

    // Without optimization the embedded images alone are several MB.
    expect(result.byteLength - blankPdf.byteLength).toBeLessThan(40 * 1024);
  });
});

describe("flattenFormTemplate: ticks, checklists, dates and repeated stamps", () => {
  /** All text drawn on page 1, via pdf.js. */
  async function textOf(pdf: Buffer, pageNo = 1): Promise<string> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
      .promise;
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    return content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  }

  /** Number of drawing operations on page 1: a tick adds a few strokes. */
  async function opCount(pdf: Buffer): Promise<number> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
      .promise;
    const ops = await (await doc.getPage(1)).getOperatorList();
    return ops.fnArray.length;
  }

  const base = async (fields: Parameters<typeof flattenFormTemplate>[0]["fields"]) =>
    flattenFormTemplate({
      blankPdf: await makeBlankPdf(),
      fields,
      signature: {
        pageNumber: 1,
        x: 50,
        y: 100,
        width: 100,
        height: 40,
        signaturePng: await makeSignaturePng(),
      },
    });

  it("prints a checklist's selected codes in the list's order", async () => {
    const out = await base([
      {
        pageNumber: 1,
        x: 50,
        y: 700,
        fontSize: 11,
        multiline: false,
        inputType: "checklist",
        checklistKey: "pcpndt_indications",
        value: "xvii,ii,bogus",
      },
    ]);
    expect(await textOf(out)).toContain("ii, xvii");
  });

  it("draws a tick only when the box is ticked", async () => {
    const tick = (value: string) => ({
      pageNumber: 1,
      x: 100,
      y: 600,
      fontSize: 11,
      multiline: false,
      inputType: "tick" as const,
      value,
    });
    const unticked = await opCount(await base([tick("")]));
    const zero = await opCount(await base([tick("0")]));
    const ticked = await opCount(await base([tick("1")]));
    expect(zero).toBe(unticked);
    expect(ticked).toBeGreaterThan(unticked);
  });

  it("prints date fields as dd/mm/yyyy and leaves other text alone", async () => {
    const out = await base([
      {
        pageNumber: 1,
        x: 50,
        y: 700,
        fontSize: 11,
        multiline: false,
        inputType: "date",
        value: "2026-10-09",
      },
      {
        pageNumber: 1,
        x: 50,
        y: 650,
        fontSize: 11,
        multiline: false,
        inputType: "text",
        value: "2026-10-09",
      },
    ]);
    const text = await textOf(out);
    expect(text).toContain("09/10/2026");
    expect(text).toContain("2026-10-09"); // the plain text field is not reformatted
  });

  it("ticks each selected checklist item at its own position, on any page", async () => {
    const field = (value: string) => ({
      pageNumber: 1,
      x: 50,
      y: 700,
      fontSize: 11,
      multiline: false,
      inputType: "checklist" as const,
      checklistKey: "pcpndt_indications",
      value,
      tickMarks: [
        { code: "i", page: 2, x: 40, y: 600 },
        { code: "ii", page: 2, x: 40, y: 580 },
        { code: "xvii", page: 2, x: 40, y: 560 },
      ],
    });
    const page2Ops = async (pdf: Buffer) => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
        .promise;
      return (await (await doc.getPage(2)).getOperatorList()).fnArray.length;
    };
    const make = async (value: string) =>
      flattenFormTemplate({
        blankPdf: await makeBlankPdf(2),
        fields: [field(value)],
        signature: {
          pageNumber: 1,
          x: 50,
          y: 100,
          width: 100,
          height: 40,
          signaturePng: await makeSignaturePng(),
        },
      });

    const none = await page2Ops(await make(""));
    const one = await page2Ops(await make("ii"));
    const two = await page2Ops(await make("ii,xvii"));
    const unknown = await page2Ops(await make("xx")); // selected, but no tick position given
    expect(one).toBeGreaterThan(none);
    expect(two).toBeGreaterThan(one);
    expect(unknown).toBe(none);
  });

  it("stamps one image in several places but stores it once", async () => {
    const stampPng = await makeSignaturePng();
    const place = (pageNumber: number, y: number) => ({
      pageNumber,
      x: 300,
      y,
      width: 80,
      height: 30,
      image: stampPng,
    });
    const countImages = async (pdf: Buffer) => {
      const doc = await PDFDocument.load(pdf);
      let n = 0;
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        const dict = (obj as { dict?: { get: (k: unknown) => unknown } }).dict;
        if (dict && String(dict.get(PDFName.of("Subtype"))) === "/Image") n++;
      }
      return n;
    };

    const once = await flattenFormTemplate({
      blankPdf: await makeBlankPdf(2),
      fields: [],
      signature: {
        pageNumber: 1,
        x: 50,
        y: 100,
        width: 100,
        height: 40,
        signaturePng: await makeSignaturePng(),
      },
      doctorSignatures: [place(1, 200)],
    });
    const thrice = await flattenFormTemplate({
      blankPdf: await makeBlankPdf(2),
      fields: [],
      signature: {
        pageNumber: 1,
        x: 50,
        y: 100,
        width: 100,
        height: 40,
        signaturePng: await makeSignaturePng(),
      },
      doctorSignatures: [place(1, 200), place(2, 200), place(2, 400)],
    });
    expect(await countImages(thrice)).toBe(await countImages(once));
  });

  it("stamps the seal and the doctor's signature on several pages, skipping a page that doesn't exist", async () => {
    const png = await makeSignaturePng();
    const out = await flattenFormTemplate({
      blankPdf: await makeBlankPdf(3),
      fields: [],
      signature: { pageNumber: 3, x: 50, y: 100, width: 100, height: 40, signaturePng: png },
      seals: [
        { pageNumber: 1, x: 300, y: 100, width: 60, height: 60, image: png },
        { pageNumber: 9, x: 300, y: 100, width: 60, height: 60, image: png }, // no page 9
      ],
      doctorSignatures: [{ pageNumber: 2, x: 300, y: 100, width: 60, height: 30, image: png }],
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
});
