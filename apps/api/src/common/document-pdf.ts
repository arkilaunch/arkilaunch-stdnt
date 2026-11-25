import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { StatementBrand } from '../billing/statement-pdf.js';

const W = 612,
  H = 792,
  M = 48,
  WIDTH = W - M * 2,
  BOTTOM = 64;
const INK = rgb(0.08, 0.1, 0.13),
  MUTED = rgb(0.35, 0.38, 0.42);

export class DocumentPdf {
  private page!: PDFPage;
  private pendingHeading: string | null = null;
  private y = H - M;
  private constructor(
    private pdf: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private title: string,
    private brand: StatementBrand,
  ) {}
  static async create(
    title: string,
    reference: string,
    brand: StatementBrand,
  ): Promise<DocumentPdf> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    pdf.setTitle(reference ? `${title} ${reference}` : title);
    pdf.setCreator('ArkiLaunch');
    const family = brand.font === 'plex' ? 'plex' : 'inter';
    const load = async (weight: string) => {
      const filename = `${family}-${weight}.ttf`;
      for (const dir of [
        resolve(__dirname, 'fonts'),
        resolve(process.cwd(), 'src/common/fonts'),
        resolve(process.cwd(), 'apps/api/src/common/fonts'),
      ]) {
        try {
          return await readFile(resolve(dir, filename));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      throw new Error(`Missing PDF font asset: ${filename}`);
    };
    const [normal, strong] = await Promise.all([load('regular'), load('bold')]);
    const doc = new DocumentPdf(
      pdf,
      await pdf.embedFont(normal, { subset: false }),
      await pdf.embedFont(strong, { subset: false }),
      title,
      brand,
    );
    doc.newPage();
    let inset = 0;
    const top = doc.y;
    if (brand.logo) {
      try {
        const image =
          brand.logo[0] === 0x89 ? await pdf.embedPng(brand.logo) : await pdf.embedJpg(brand.logo);
        const size = image.scaleToFit(64, 48);
        doc.page.drawImage(image, { x: M, y: doc.y - size.height, ...size });
        inset = size.width + 14;
      } catch {
        /* Corrupt branding falls back to text. */
      }
    }
    for (const [value, size, font] of [
      [brand.name || 'Rental company', 14, doc.bold],
      [brand.address, 8, doc.font],
      [brand.contact, 8, doc.font],
      [brand.tin ? `TIN ${brand.tin}` : '', 8, doc.font],
    ] as const) {
      if (!value) continue;
      for (const line of doc.wrap(value, WIDTH - inset, size, font)) {
        doc.ensure(size + 5);
        doc.text(line, M + inset, doc.y - size, size, font);
        doc.y -= size + 5;
      }
    }
    doc.y = Math.min(doc.y, top - (inset ? 52 : 0)) - 8;
    doc.heading(title);
    if (reference) doc.paragraph(`Reference: ${reference}`);
    return doc;
  }
  private text(value: string, x: number, y: number, size = 9, font = this.font) {
    this.page.drawText(
      Array.from(value)
        .filter((c) => c.charCodeAt(0) >= 32)
        .join(''),
      { x, y, size, font, color: INK },
    );
  }
  private wrap(value: string, width: number, size = 9, font = this.font): string[] {
    const lines: string[] = [];
    for (const paragraph of value.replace(/\r/g, '').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          line = next;
          continue;
        }
        if (line) {
          lines.push(line);
          line = '';
        }
        for (const character of word) {
          if (line && font.widthOfTextAtSize(line + character, size) > width) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  private newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = H - M;
    if (this.pdf.getPageCount() > 1) {
      for (const line of this.wrap(
        `${this.brand.name || 'Rental company'} | ${this.title}`,
        WIDTH,
        8,
        this.bold,
      )) {
        this.text(line, M, this.y - 8, 8, this.bold);
        this.y -= 12;
      }
      this.y -= 12;
    }
  }
  private ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }
  heading(value: string) {
    this.flushHeading(0);
    this.pendingHeading = value;
  }
  private flushHeading(following: number) {
    const value = this.pendingHeading;
    if (value === null) return;
    this.pendingHeading = null;
    this.renderHeading(value, following);
  }
  private renderHeading(value: string, following: number) {
    const lines = this.wrap(value, WIDTH, 12, this.bold);
    this.ensure(Math.min(lines.length * 16 + 23 + following, H - M - BOTTOM - 60));
    this.y -= 6;
    for (const line of lines) {
      this.ensure(18);
      this.text(line, M, this.y - 12, 12, this.bold);
      this.y -= 16;
    }
    const color = /^#[0-9a-f]{6}$/i.test(this.brand.primaryColor ?? '')
      ? this.brand.primaryColor!
      : '#263746';
    const accent = rgb(
      parseInt(color.slice(1, 3), 16) / 255,
      parseInt(color.slice(3, 5), 16) / 255,
      parseInt(color.slice(5, 7), 16) / 255,
    );
    this.page.drawLine({
      start: { x: M, y: this.y - 4 },
      end: { x: W - M, y: this.y - 4 },
      thickness: 1.5,
      color: accent,
    });
    this.y -= 17;
  }
  reserve(height: number) {
    this.ensure(height);
  }
  paragraph(value: string) {
    this.flushHeading(13);
    for (const line of this.wrap(value, WIDTH)) {
      this.ensure(13);
      this.text(line, M, this.y - 9);
      this.y -= 13;
    }
    this.y -= 7;
  }
  facts(pairs: [string, string][]) {
    this.table(['Detail', 'Value'], pairs, [0.32, 0.68]);
  }
  table(headers: string[], rows: string[][], widths?: number[]) {
    if (!headers.length) return;
    const weights =
      widths?.length === headers.length && widths.every((w) => Number.isFinite(w) && w > 0)
        ? widths
        : headers.map(() => 1);
    const total = weights.reduce((sum, w) => sum + w, 0),
      columns = weights.map((w) => (WIDTH * w) / total);
    const cellLines = (cells: string[], font: PDFFont) =>
      cells.map((cell, i) => this.wrap(cell, Math.max(8, columns[i]! - 12), 8, font));
    const headerLines = cellLines(headers, this.bold),
      headHeight = Math.max(...headerLines.map((l) => l.length)) * 12 + 12;
    const draw = (lines: string[][], header: boolean, offset: number, count: number) => {
      const height = count * 12 + 12;
      let x = M;
      if (header)
        this.page.drawRectangle({
          x: M,
          y: this.y - height,
          width: WIDTH,
          height,
          color: rgb(0.94, 0.95, 0.96),
        });
      lines.forEach((cell, i) => {
        const font = header ? this.bold : this.font;
        const monetary = !header && /^-?PHP [\d,.]+$/.test(cell.join(' '));
        cell.slice(offset, offset + count).forEach((line, j) => {
          const left = monetary ? x + columns[i]! - 6 - font.widthOfTextAtSize(line, 8) : x + 6;
          this.text(line, left, this.y - 15 - j * 12, 8, font);
        });
        x += columns[i]!;
      });
      this.y -= height;
      this.page.drawLine({
        start: { x: M, y: this.y },
        end: { x: W - M, y: this.y },
        thickness: 0.4,
        color: rgb(0.8, 0.82, 0.84),
      });
    };
    const head = () => draw(headerLines, true, 0, (headHeight - 12) / 12);
    const firstLines = cellLines(rows[0] ?? headers.map(() => ''), this.font);
    const firstHeight = Math.min(
      Math.max(...firstLines.map((lines) => lines.length)) * 12 + 12,
      H - M - BOTTOM - headHeight - 60,
    );
    this.flushHeading(headHeight + firstHeight);
    this.ensure(headHeight + firstHeight);
    head();
    for (const row of rows.length ? rows : [headers.map((_, i) => (i === 0 ? 'None' : ''))]) {
      const lines = cellLines(
          headers.map((_, i) => row[i] ?? ''),
          this.font,
        ),
        length = Math.max(...lines.map((l) => l.length));
      if (
        this.y - length * 12 - 12 < BOTTOM &&
        length * 12 + 12 < H - M - BOTTOM - headHeight - 60
      ) {
        this.newPage();
        head();
      }
      let offset = 0;
      while (offset < length) {
        if (this.y - 24 < BOTTOM) {
          this.newPage();
          head();
        }
        const count = Math.min(
          length - offset,
          Math.max(1, Math.floor((this.y - BOTTOM - 12) / 12)),
        );
        draw(lines, false, offset, count);
        offset += count;
      }
    }
    this.y -= 12;
  }
  async signature(dataUrl: string) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error('Invalid signature image');
    const image = await this.pdf.embedPng(Buffer.from(match[1]!, 'base64')),
      size = image.scaleToFit(220, 90);
    this.ensure(size.height + 20);
    this.page.drawImage(image, { x: M, y: this.y - size.height, ...size });
    this.y -= size.height + 20;
  }
  async finish(): Promise<Uint8Array> {
    this.flushHeading(0);
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      const count = `Page ${i + 1} of ${pages.length}`;
      const size = 8;
      const countWidth = this.font.widthOfTextAtSize(count, size);
      page.drawLine({ start: { x: M, y: 47 }, end: { x: W - M, y: 47 }, thickness: 0.5, color: MUTED });
      const brandLines = this.wrap(this.brand.name || 'Rental company', WIDTH - countWidth - 20, size);
      brandLines.slice(0, 2).forEach((line, j) =>
        page.drawText(line, { x: M, y: 33 - j * 10, size, font: this.font, color: MUTED }),
      );
      page.drawText(count, { x: W - M - countWidth, y: 33, size, font: this.font, color: MUTED });
    });
    return this.pdf.save();
  }
}
