import "server-only";

import sharp from "sharp";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Simple greedy word wrap -- good enough for a declaration paragraph, not typeset-quality. */
function wrapText(text: string, maxCharsPerLine = 70): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = (current + " " + word).trim();
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Composites a hand-drawn signature (from the phone signature pad)
 * with the document type's declaration text and a patient/timestamp
 * footer into a single PNG, so the saved document is self-contained
 * evidence of what was signed rather than a bare, contextless
 * squiggle. Declaration text renders above the signature, a footer
 * line below it.
 */
export async function compositeSignatureWithDeclaration(input: {
  signaturePng: Buffer;
  documentTypeName: string;
  declarationText: string | null;
  patientName: string;
}): Promise<Buffer> {
  const signatureMeta = await sharp(input.signaturePng, { failOn: "none" }).metadata();
  const width = signatureMeta.width ?? 600;
  const signatureHeight = signatureMeta.height ?? 200;

  const lines = input.declarationText ? wrapText(input.declarationText) : [];
  const headerHeight = 36 + lines.length * 20 + 16;
  const footerHeight = 40;
  const totalHeight = headerHeight + signatureHeight + footerHeight;

  const headerSvg = `<svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="16" y="24" font-family="sans-serif" font-size="16" font-weight="600">${escapeXml(input.documentTypeName)}</text>
    ${lines.map((line, i) => `<text x="16" y="${48 + i * 20}" font-family="sans-serif" font-size="13">${escapeXml(line)}</text>`).join("")}
  </svg>`;

  const footerSvg = `<svg width="${width}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <line x1="16" y1="4" x2="${width - 16}" y2="4" stroke="#999999" stroke-width="1"/>
    <text x="16" y="26" font-family="sans-serif" font-size="12" fill="#555555">Signed by ${escapeXml(input.patientName)} — ${escapeXml(new Date().toISOString())}</text>
  </svg>`;

  return (
    sharp({
      create: { width, height: totalHeight, channels: 4, background: "#ffffff" },
    })
      .composite([
        { input: Buffer.from(headerSvg), left: 0, top: 0 },
        { input: input.signaturePng, left: 0, top: headerHeight },
        { input: Buffer.from(footerSvg), left: 0, top: headerHeight + signatureHeight },
      ])
      // Text on white, a handful of colours: palette PNG is a fraction
      // of the size of a truecolour one with no visible difference.
      .png({ palette: true, quality: 80, compressionLevel: 9 })
      .toBuffer()
  );
}
