import path from "node:path";
import PDFDocument from "pdfkit";
import type { ResumeData } from "@/lib/db/schema";

const PAGE_MARGIN_X = 40;
const PAGE_MARGIN_TOP = 32;
const PAGE_MARGIN_BOTTOM = 32;

const BLUE = "#1F4E79";
const BLACK = "#111111";

const NAME_SIZE = 20;
const CONTACT_SIZE = 10;
const SECTION_HEADER_SIZE = 12;
const SUBHEADER_SIZE = 10;
const BODY_SIZE = 10;

const fontsDir = path.join(process.cwd(), "assets", "fonts");
const FONTS = {
  regular: path.join(fontsDir, "Carlito-Regular.ttf"),
  bold: path.join(fontsDir, "Carlito-Bold.ttf"),
  italic: path.join(fontsDir, "Carlito-Italic.ttf"),
  boldItalic: path.join(fontsDir, "Carlito-BoldItalic.ttf"),
};

export async function renderResumePdf(
  resume: ResumeData,
  meta: { author?: string; title?: string } = {}
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "Letter",
    // pdfkit defaults to eagerly loading its bundled Helvetica AFM file via
    // __dirname, which Turbopack's dev bundler rewrites to a bogus path
    // (ENOENT). We only ever use Carlito, registered below, so skip it.
    font: false,
    margins: {
      top: PAGE_MARGIN_TOP,
      bottom: PAGE_MARGIN_BOTTOM,
      left: PAGE_MARGIN_X,
      right: PAGE_MARGIN_X,
    },
    info: {
      Author: meta.author ?? "Gaurav Patanker Resume Generator",
      Title: meta.title ?? `${resume.name} — Resume`,
    },
    // @types/pdfkit doesn't model `font: false` (skip default font load),
    // even though pdfkit itself supports it at runtime.
  } as unknown as PDFKit.PDFDocumentOptions);

  doc.registerFont("Body", FONTS.regular);
  doc.registerFont("Body-Bold", FONTS.bold);
  doc.registerFont("Body-Italic", FONTS.italic);
  doc.registerFont("Body-BoldItalic", FONTS.boldItalic);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2;
  const rightEdge = pageWidth - PAGE_MARGIN_X;

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // --- Header ---
  doc.font("Body-Bold").fontSize(NAME_SIZE).fillColor(BLACK);
  doc.text(resume.name, PAGE_MARGIN_X, doc.y, {
    width: contentWidth,
    align: "center",
  });

  writeContactLine(doc, resume.contactLine, PAGE_MARGIN_X, doc.y + 2, contentWidth);

  doc.moveDown(0.5);
  divider(doc, rightEdge);
  doc.moveDown(0.5);

  // --- Education (two per line, like the base resume) ---
  // No divider under this header — the section is a single tight line, so
  // a rule directly under the title reads as a stray line rather than a
  // section break.
  sectionHeader(doc, "Education", rightEdge, contentWidth, { divider: false });
  for (let i = 0; i < resume.education.length; i += 2) {
    const left = resume.education[i];
    const right = resume.education[i + 1];
    const colWidth = contentWidth / 2 - 6;
    const startY = doc.y;

    writeEducationEntry(doc, left, PAGE_MARGIN_X, startY, colWidth);
    let lineHeight = doc.y - startY;
    if (right) {
      const rightStartY = startY;
      writeEducationEntry(
        doc,
        right,
        PAGE_MARGIN_X + contentWidth / 2 + 6,
        rightStartY,
        colWidth
      );
      lineHeight = Math.max(lineHeight, doc.y - rightStartY);
    }
    doc.x = PAGE_MARGIN_X;
    doc.y = startY + lineHeight + 2;
  }
  doc.moveDown(0.5);

  // --- Professional Experience ---
  sectionHeader(doc, "Professional Experience", rightEdge, contentWidth);
  resume.experience.forEach((exp, idx) => {
    const headerLeft = [exp.company, exp.role, exp.team, exp.location]
      .filter(Boolean)
      .join(" – ");
    lineWithRightAlign(
      doc,
      headerLeft,
      exp.dateRange,
      PAGE_MARGIN_X,
      rightEdge,
      contentWidth,
      SUBHEADER_SIZE
    );
    doc.moveDown(0.25);

    exp.bullets.forEach((bullet) => {
      writeBullet(doc, bullet.text, PAGE_MARGIN_X, contentWidth);
      doc.moveDown(0.12);
    });

    if (idx < resume.experience.length - 1) doc.moveDown(0.4);
  });
  doc.moveDown(0.4);

  // --- Projects ---
  if (resume.projects.length > 0) {
    sectionHeader(doc, "Projects", rightEdge, contentWidth);
    resume.projects.forEach((project) => {
      const headerLeft = [project.name, project.org]
        .filter(Boolean)
        .join(" – ");
      lineWithRightAlign(
        doc,
        headerLeft,
        project.dateRange,
        PAGE_MARGIN_X,
        rightEdge,
        contentWidth,
        SUBHEADER_SIZE
      );
      doc.moveDown(0.25);
      project.bullets.forEach((bulletText) => {
        writeBullet(doc, bulletText, PAGE_MARGIN_X, contentWidth);
        doc.moveDown(0.12);
      });
    });
    doc.moveDown(0.4);
  }

  // --- Skills ---
  sectionHeader(doc, "Skills", rightEdge, contentWidth);
  resume.skills.forEach((skill) => {
    const startY = doc.y;
    doc.font("Body-Bold").fontSize(BODY_SIZE).fillColor(BLACK);
    const label = `${skill.category}: `;
    doc.text(label, PAGE_MARGIN_X, startY, {
      continued: true,
      lineBreak: false,
    });
    doc.font("Body").fontSize(BODY_SIZE);
    doc.text(skill.items.join(", "));
    doc.moveDown(0.12);
  });
  doc.moveDown(0.4);

  // --- Certifications ---
  if (resume.certifications.length > 0) {
    sectionHeader(doc, "Certifications", rightEdge, contentWidth);
    doc.font("Body-Bold").fontSize(BODY_SIZE).fillColor(BLACK);
    doc.text("Certifications: ", PAGE_MARGIN_X, doc.y, {
      continued: true,
      lineBreak: false,
    });
    doc.font("Body").fontSize(BODY_SIZE);
    doc.text(resume.certifications.join(", "));
  }

  doc.end();
  return done;
}

/** Renders the centered contact line, underlining/linking a LinkedIn URL if present (matches the base resume's hyperlinked LinkedIn styling). */
function writeContactLine(
  doc: PDFKit.PDFDocument,
  text: string,
  pageMarginX: number,
  y: number,
  contentWidth: number
) {
  doc.font("Body").fontSize(CONTACT_SIZE).fillColor(BLACK);

  const linkMatch = text.match(/\S*linkedin\.com\S*/i);
  if (!linkMatch) {
    doc.text(text, pageMarginX, y, { width: contentWidth, align: "center" });
    return;
  }

  const linkText = linkMatch[0];
  const idx = text.indexOf(linkText);
  const before = text.slice(0, idx);
  const after = text.slice(idx + linkText.length);
  const url = linkText.startsWith("http") ? linkText : `https://${linkText}`;

  const beforeWidth = doc.widthOfString(before);
  const linkWidth = doc.widthOfString(linkText);
  const afterWidth = doc.widthOfString(after);
  const totalWidth = beforeWidth + linkWidth + afterWidth;
  const startX = pageMarginX + (contentWidth - totalWidth) / 2;
  const lineHeight = doc.currentLineHeight();

  doc.text(before, startX, y, { continued: true, lineBreak: false });
  doc.text(linkText, { continued: true, lineBreak: false });
  doc.text(after, { lineBreak: false });
  // The final segment uses lineBreak:false (so it doesn't wrap/continue),
  // which also means pdfkit won't auto-advance the cursor past this line —
  // do it explicitly so later content doesn't overlap this line.
  doc.x = pageMarginX;
  doc.y = y + lineHeight;

  // Underline + clickable annotation are drawn manually rather than via
  // pdfkit's inline `underline`/`link` text options — combining those with
  // `continued: true` produces an invalid (NaN) annotation rectangle.
  const linkX = startX + beforeWidth;
  const underlineY = y + lineHeight - 2;
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor(BLACK)
    .moveTo(linkX, underlineY)
    .lineTo(linkX + linkWidth, underlineY)
    .stroke()
    .restore();
  doc.link(linkX, y, linkWidth, lineHeight, url);
}

function divider(doc: PDFKit.PDFDocument, rightEdge: number) {
  const y = doc.y;
  doc
    .moveTo(PAGE_MARGIN_X, y)
    .lineTo(rightEdge, y)
    .lineWidth(1)
    .strokeColor(BLUE)
    .stroke();
}

function sectionHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  rightEdge: number,
  contentWidth: number,
  options: { divider?: boolean } = {}
) {
  const showDivider = options.divider ?? true;
  doc.font("Body-Bold").fontSize(SECTION_HEADER_SIZE).fillColor(BLACK);
  doc.text(title.toUpperCase(), PAGE_MARGIN_X, doc.y, { width: contentWidth });
  if (showDivider) {
    const ruleY = doc.y + 1;
    doc
      .moveTo(PAGE_MARGIN_X, ruleY)
      .lineTo(rightEdge, ruleY)
      .lineWidth(1)
      .strokeColor(BLUE)
      .stroke();
    doc.y = ruleY + 4;
  } else {
    doc.y = doc.y + 4;
  }
  doc.x = PAGE_MARGIN_X;
}

function writeEducationEntry(
  doc: PDFKit.PDFDocument,
  entry: { school: string; degree: string } | undefined,
  x: number,
  y: number,
  width: number
) {
  if (!entry) return;
  doc.font("Body-Bold").fontSize(BODY_SIZE).fillColor(BLACK);
  doc.text(entry.school, x, y, { continued: true, lineBreak: false, width });
  doc.font("Body-Italic").fontSize(BODY_SIZE);
  doc.text(` | ${entry.degree}`, { width });
}

function lineWithRightAlign(
  doc: PDFKit.PDFDocument,
  leftText: string,
  rightText: string,
  x: number,
  rightEdge: number,
  contentWidth: number,
  fontSize: number
) {
  const startY = doc.y;
  doc.font("Body-Bold").fontSize(fontSize).fillColor(BLACK);
  const rightWidth = doc.widthOfString(rightText) + 4;
  doc.text(leftText, x, startY, {
    width: contentWidth - rightWidth,
    lineBreak: false,
  });
  doc.text(rightText, rightEdge - rightWidth, startY, {
    width: rightWidth,
    align: "right",
    lineBreak: false,
  });
  doc.x = x;
}

function writeBullet(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  contentWidth: number
) {
  const bulletIndent = 12;
  const startY = doc.y;
  doc.font("Body").fontSize(BODY_SIZE).fillColor(BLACK);
  doc.text("•", x + 2, startY, { lineBreak: false });
  doc.text(text, x + bulletIndent, startY, {
    width: contentWidth - bulletIndent,
    align: "justify",
  });
  doc.x = x;
}
