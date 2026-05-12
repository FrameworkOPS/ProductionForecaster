import PDFDocument from 'pdfkit';
import { Response } from 'express';

const TEAL = '#006B6B';
const DARK = '#1a1a1a';
const LIGHT_GRAY = '#f5f5f5';
const MID_GRAY = '#888888';
const TABLE_BORDER = '#dddddd';

interface BidProject {
  name: string;
  project_address: string;
  gc_name: string;
  bid_date: string;
  project_type: string;
  notes: string;
}

interface TakeoffRow {
  label: string;
  value: string;
  unit: string;
  category: string;
}

interface SpecRow {
  section: string;
  spec_type: string;
  description: string;
  value: string;
}

interface LineItem {
  category: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  line_total: string;
  notes: string;
}

interface ConcernRow {
  description: string;
  severity: string;
}

interface BidData {
  project: BidProject;
  takeoffs: TakeoffRow[];
  specs: SpecRow[];
  lineItems: LineItem[];
  concerns: ConcernRow[];
}

function formatCurrency(val: string | number): string {
  const n = parseFloat(String(val));
  if (isNaN(n)) return '$0.00';
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumber(val: string | number): string {
  const n = parseFloat(String(val));
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function generateBidPdf(data: BidData, res: Response): void {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="bid-${data.project.name.replace(/\s+/g, '-')}.pdf"`
  );
  doc.pipe(res);

  // ── COVER PAGE ──────────────────────────────────────────────────────────────
  drawCoverPage(doc, data.project);

  // ── TAKEOFFS PAGE ──────────────────────────────────────────────────────────
  if (data.takeoffs.length > 0) {
    doc.addPage();
    drawSectionHeader(doc, 'MATERIAL TAKEOFFS');
    drawTakeoffTable(doc, data.takeoffs);
  }

  // ── DIVISION 7 SPECS PAGE ──────────────────────────────────────────────────
  if (data.specs.length > 0) {
    doc.addPage();
    drawSectionHeader(doc, 'DIVISION 7 SPECIFICATIONS');
    drawSpecsTable(doc, data.specs);
  }

  // ── LINE ITEMS / BID DETAIL PAGE ───────────────────────────────────────────
  if (data.lineItems.length > 0) {
    doc.addPage();
    drawSectionHeader(doc, 'BID DETAILS');
    drawLineItemsTable(doc, data.lineItems);
  }

  // ── AREAS OF CONCERN PAGE ─────────────────────────────────────────────────
  if (data.concerns.length > 0) {
    doc.addPage();
    drawSectionHeader(doc, 'AREAS OF CONCERN');
    drawConcerns(doc, data.concerns);
  }

  // ── PAGE NUMBERS ──────────────────────────────────────────────────────────
  const totalPages = (doc as any).bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor(MID_GRAY)
      .text(`Page ${i + 1} of ${totalPages}`, 50, doc.page.height - 40, {
        align: 'center',
        width: doc.page.width - 100,
      });
  }

  doc.end();
}

function drawCoverPage(doc: PDFKit.PDFDocument, project: BidProject) {
  // Top teal bar
  doc.rect(0, 0, doc.page.width, 8).fill(TEAL);

  // Header area
  doc.rect(0, 8, doc.page.width, 120).fill('#f8f8f8');
  doc
    .fontSize(28)
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .text('SKYRIGHT', 50, 35);
  doc
    .fontSize(11)
    .fillColor(TEAL)
    .font('Helvetica')
    .text('ROOFING · GUTTERS · SIDING', 50, 68);

  doc
    .fontSize(9)
    .fillColor(MID_GRAY)
    .text('office@skyright.com  |  (208) 597-0101', 50, 95);

  // Title
  doc
    .fontSize(22)
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .text('COMMERCIAL BID PACKAGE', 50, 165);
  doc.rect(50, 195, 200, 3).fill(TEAL);

  // Project info box
  const boxY = 215;
  doc.rect(50, boxY, doc.page.width - 100, 200).fill(LIGHT_GRAY);

  const labelX = 65;
  const valueX = 200;
  let y = boxY + 20;
  const rowH = 30;

  const rows: [string, string][] = [
    ['Project:', project.name],
    ['Address:', project.project_address || '—'],
    ['General Contractor:', project.gc_name || '—'],
    ['Bid Date:', project.bid_date ? new Date(project.bid_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'],
    ['Scope:', (project.project_type || 'roofing').toUpperCase()],
  ];

  for (const [label, value] of rows) {
    doc.fontSize(9).fillColor(MID_GRAY).font('Helvetica-Bold').text(label, labelX, y);
    doc.fontSize(10).fillColor(DARK).font('Helvetica').text(value, valueX, y, { width: doc.page.width - valueX - 65 });
    y += rowH;
  }

  if (project.notes) {
    doc.addPage();
    drawSectionHeader(doc, 'SCOPE OF WORK');
    doc.fontSize(10).fillColor(DARK).font('Helvetica').text(project.notes, 50, 130, { width: doc.page.width - 100, lineGap: 4 });
  }
}

function drawSectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc
    .fontSize(18)
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .text(title, 50, 60);
  doc.rect(50, 86, 250, 3).fill(TEAL);
}

function drawTakeoffTable(doc: PDFKit.PDFDocument, takeoffs: TakeoffRow[]) {
  const cols = { label: 50, value: 320, unit: 410, cat: 480 };
  const headers = ['Measurement', 'Value', 'Unit', 'Category'];
  let y = 105;

  // Header row
  doc.rect(50, y, doc.page.width - 100, 22).fill(TEAL);
  doc.fontSize(9).fillColor('white').font('Helvetica-Bold');
  doc.text(headers[0], cols.label + 5, y + 7);
  doc.text(headers[1], cols.value, y + 7);
  doc.text(headers[2], cols.unit, y + 7);
  doc.text(headers[3], cols.cat, y + 7);
  y += 22;

  let alt = false;
  for (const row of takeoffs) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 60;
    }
    if (alt) doc.rect(50, y, doc.page.width - 100, 20).fill('#f9f9f9');
    doc.fontSize(9).fillColor(DARK).font('Helvetica');
    doc.text(row.label, cols.label + 5, y + 6, { width: cols.value - cols.label - 10 });
    doc.text(formatNumber(row.value), cols.value, y + 6);
    doc.text(row.unit || '', cols.unit, y + 6);
    doc.text(row.category || '', cols.cat, y + 6);
    doc.rect(50, y, doc.page.width - 100, 20).stroke(TABLE_BORDER);
    y += 20;
    alt = !alt;
  }
}

function drawSpecsTable(doc: PDFKit.PDFDocument, specs: SpecRow[]) {
  let y = 105;
  let currentSection = '';

  for (const spec of specs) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 60;
    }

    if (spec.section !== currentSection) {
      currentSection = spec.section;
      y += 10;
      doc.fontSize(10).fillColor(TEAL).font('Helvetica-Bold').text(spec.section, 50, y);
      y += 18;
    }

    const badgeColor = spec.spec_type === 'warranty' ? '#e8f5e9' : spec.spec_type === 'approved_product' ? '#e3f2fd' : LIGHT_GRAY;
    doc.rect(55, y, doc.page.width - 110, 32).fill(badgeColor);
    doc.fontSize(8).fillColor(MID_GRAY).font('Helvetica-Bold').text(spec.spec_type?.toUpperCase() || '', 62, y + 4);
    doc.fontSize(9).fillColor(DARK).font('Helvetica').text(spec.description || '', 62, y + 14, { width: 200 });
    if (spec.value) {
      doc.fontSize(9).fillColor(DARK).font('Helvetica-Bold').text(spec.value, 280, y + 4, { width: doc.page.width - 340 });
    }
    y += 38;
  }
}

function drawLineItemsTable(doc: PDFKit.PDFDocument, items: LineItem[]) {
  const cols = { desc: 50, qty: 280, unit: 340, price: 390, total: 460 };
  let y = 105;
  let grandTotal = 0;
  let currentCategory = '';

  // Header
  doc.rect(50, y, doc.page.width - 100, 22).fill(TEAL);
  doc.fontSize(9).fillColor('white').font('Helvetica-Bold');
  doc.text('Description', cols.desc + 5, y + 7, { width: 220 });
  doc.text('Qty', cols.qty, y + 7);
  doc.text('Unit', cols.unit, y + 7);
  doc.text('Unit Price', cols.price, y + 7);
  doc.text('Line Total', cols.total, y + 7);
  y += 22;

  let alt = false;
  for (const item of items) {
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = 60;
    }

    if (item.category !== currentCategory) {
      currentCategory = item.category;
      y += 6;
      doc.rect(50, y, doc.page.width - 100, 18).fill('#e8f0ee');
      doc.fontSize(9).fillColor(TEAL).font('Helvetica-Bold').text(item.category?.toUpperCase() || '', cols.desc + 5, y + 5);
      y += 18;
    }

    if (alt) doc.rect(50, y, doc.page.width - 100, 22).fill('#f9f9f9');
    doc.fontSize(9).fillColor(DARK).font('Helvetica');
    doc.text(item.description, cols.desc + 5, y + 7, { width: 220 });
    doc.text(formatNumber(item.quantity), cols.qty, y + 7);
    doc.text(item.unit || '', cols.unit, y + 7);
    doc.text(formatCurrency(item.unit_price), cols.price, y + 7);
    const total = parseFloat(item.line_total || '0') || (parseFloat(item.quantity || '0') * parseFloat(item.unit_price || '0'));
    doc.text(formatCurrency(total), cols.total, y + 7);
    grandTotal += total;
    doc.rect(50, y, doc.page.width - 100, 22).stroke(TABLE_BORDER);
    y += 22;
    alt = !alt;
  }

  // Grand total
  y += 10;
  doc.rect(50, y, doc.page.width - 100, 28).fill(TEAL);
  doc.fontSize(11).fillColor('white').font('Helvetica-Bold');
  doc.text('TOTAL', cols.desc + 5, y + 8);
  doc.text(formatCurrency(grandTotal), cols.total - 10, y + 8);
}

function drawConcerns(doc: PDFKit.PDFDocument, concerns: ConcernRow[]) {
  const severityColors: Record<string, string> = { high: '#ffebee', medium: '#fff8e1', low: '#e8f5e9' };
  const severityTextColors: Record<string, string> = { high: '#c62828', medium: '#ef6c00', low: '#2e7d32' };
  let y = 105;

  for (const concern of concerns) {
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = 60;
    }

    const bg = severityColors[concern.severity] || LIGHT_GRAY;
    const tc = severityTextColors[concern.severity] || DARK;
    const height = Math.max(40, Math.ceil(concern.description.length / 80) * 14 + 20);

    doc.rect(50, y, doc.page.width - 100, height).fill(bg);
    doc.rect(50, y, 4, height).fill(tc);
    doc
      .fontSize(8)
      .fillColor(tc)
      .font('Helvetica-Bold')
      .text((concern.severity || 'medium').toUpperCase(), 62, y + 6);
    doc
      .fontSize(9)
      .fillColor(DARK)
      .font('Helvetica')
      .text(concern.description, 62, y + 18, { width: doc.page.width - 125 });
    y += height + 8;
  }
}
