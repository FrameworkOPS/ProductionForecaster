import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Anthropic accepts up to ~32 MB per request. base64 inflates the PDF by ~33%,
// so cap binary chunk size well below that to leave headroom for the prompt & overhead.
const MAX_CHUNK_BYTES = 18 * 1024 * 1024;
const MAX_CHUNK_PAGES = 30;

interface ParsedDocument {
  docType: 'roofscope' | 'sidingscope' | 'spec_sheet' | 'plan_set' | 'unknown';
  takeoffs: TakeoffItem[];
  specs: SpecItem[];
  concerns: ConcernItem[];
  lineItems: LineItemSuggestion[];
  summary: string;
}

export interface TakeoffItem {
  label: string;
  value: number;
  unit: string;
  category: string;
  source: string;
}

export interface SpecItem {
  section: string;
  spec_type: 'material' | 'warranty' | 'standard' | 'note' | 'approved_product';
  description: string;
  value: string;
}

export interface ConcernItem {
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface LineItemSuggestion {
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  waste_factor: number;
  notes: string;
  sort_order: number;
  // Identifier the parser thinks best matches the price DB (e.g. "TPO_MEMBRANE_60MIL").
  // Used downstream to find a match; if no match, the line item is flagged.
  material_key?: string;
}

const PARSE_PROMPT = `You are an expert estimator for a commercial roofing and siding contractor in the Pacific Northwest. Analyze this PDF and extract EVERY piece of estimating data.

DOCUMENT TYPES:
- roofscope: aerial roof measurement report (areas, ridges, hips, valleys, eaves, rakes, penetrations)
- sidingscope: aerial siding measurement report (wall areas, openings, corners, trim)
- spec_sheet: project manual / written specifications (Divisions 6, 7, 9 etc.)
- plan_set: architectural drawings (plans, elevations, sections, details)

EXTRACTION RULES:

1. TAKEOFFS — extract EVERY measurement. Examples:
   ROOFING: total roof area (SQ), ridges (LF), hips (LF), valleys (LF), eaves (LF), rakes (LF), step flashing (LF), penetrations (each), skylights (each), drains (each), parapet (LF), pitch breakdown by area
   SIDING: total wall area (SF), corners inside/outside (LF), J-channel (LF), starter strip (LF), soffit (SF), fascia (LF), openings count and trim (LF), trim packages
   Always include unit. Use SQ for roofing squares (100 SF), SF for siding square feet, LF for linear feet, EA for each.

2. SPECS — from spec sheets, capture every requirement in Divisions 6 (Wood/Plastics), 7 (Thermal & Moisture), 9 (Finishes), and any siding/roofing related sections:
   - Approved manufacturers and exact product names
   - Material specs (thickness, mil, gauge, color, R-value, weight, finish)
   - Warranty terms (years, NDL, system, material vs labor)
   - Performance requirements (wind uplift, fire rating, hail rating, ASTM standards)
   - Underlayment, fasteners, sealants, flashings, adhesives
   - Application requirements & substrate prep

3. LINE ITEMS — generate a COMPLETE bid. Cover every material and labor scope you can infer from takeoffs + specs:
   ROOFING SCOPE: tear-off, deck repair, underlayment, ice & water shield, drip edge, starter, field shingles/membrane, ridge cap, hip & ridge, valley metal, step flashing, counter flashing, pipe boots, ventilation, skylight flashing, parapet wrap, drains, scuppers, walkway pads, edge metal, fasteners, sealant, dumpster, permits, labor
   SIDING SCOPE: tear-off, WRB / housewrap, flashing tape, trim (J-channel, starter, corners, finish trim, F-channel, soffit, fascia), siding panels, vented soffit, accessories, fasteners, caulk, labor, scaffolding
   For every line item, include a material_key — an UPPER_SNAKE_CASE identifier that describes the canonical material (e.g. "TPO_MEMBRANE_60MIL_WHITE", "GAF_TIMBERLINE_HDZ", "JAMES_HARDIE_PLANK_SELECT_CEDARMILL", "LP_SMARTSIDE_38_TRIM_4IN"). This is used to look up prices in the contractor's database.

4. CONCERNS — flag anything that adds risk:
   - Complex flashing details, custom fab
   - Spec conflicts between plans and specs
   - Existing conditions concerns
   - Access / scaffolding / safety
   - Penetrations through specialty materials
   - Cold-weather application limits
   - Submittal & long-lead items

Respond with ONLY valid JSON (no markdown fences, no commentary):
{
  "docType": "roofscope" | "sidingscope" | "spec_sheet" | "plan_set" | "unknown",
  "summary": "1–2 sentences describing what was found and the scope",
  "takeoffs": [
    { "label": "Total Roof Area", "value": 588.66, "unit": "SQ", "category": "roof", "source": "RoofScope" }
  ],
  "specs": [
    { "section": "07 50 00 - Membrane Roofing", "spec_type": "material", "description": "TPO Membrane", "value": "60 mil white, mechanically fastened, 20-yr NDL" }
  ],
  "concerns": [
    { "description": "Complex parapet/curb intersections at north elevation — custom flashing", "severity": "high" }
  ],
  "lineItems": [
    { "category": "Roofing", "description": "TPO Membrane 60 mil white, mechanically fastened", "quantity": 588.66, "unit": "SQ", "unit_price": 0, "waste_factor": 10, "notes": "Per spec 07 50 00", "sort_order": 1, "material_key": "TPO_MEMBRANE_60MIL_WHITE_MECH" }
  ]
}

Leave unit_price as 0 — the contractor's price database will fill it in.`;

export async function parsePdfDocument(pdfPath: string): Promise<ParsedDocument> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const buffer = fs.readFileSync(pdfPath);
  return parsePdfBuffer(buffer);
}

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedDocument> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const chunks = await splitPdf(buffer);
  if (chunks.length === 1) {
    return parsePdfSingle(chunks[0]);
  }
  const partials = await Promise.all(chunks.map((c, i) => parsePdfSingle(c, `pages chunk ${i + 1} of ${chunks.length}`)));
  return mergeParsedDocuments(partials);
}

async function splitPdf(buffer: Buffer): Promise<Buffer[]> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    // Can't load — hand the original buffer over and let the API surface a clearer error
    return [buffer];
  }
  const totalPages = src.getPageCount();
  if (totalPages <= MAX_CHUNK_PAGES && buffer.byteLength <= MAX_CHUNK_BYTES) return [buffer];

  // Pick a page budget that also keeps each chunk under the byte cap
  const avgBytesPerPage = buffer.byteLength / totalPages;
  const pagesByBytes = Math.max(1, Math.floor(MAX_CHUNK_BYTES / avgBytesPerPage));
  const startingPagesPerChunk = Math.max(1, Math.min(MAX_CHUNK_PAGES, pagesByBytes));

  const chunks: Buffer[] = [];
  for (let start = 0; start < totalPages; start += startingPagesPerChunk) {
    const end = Math.min(start + startingPagesPerChunk, totalPages);
    const slice = await extractPages(src, start, end);
    // Belt-and-braces: if a chunk is still oversize (heavy graphics), halve recursively
    if (slice.byteLength > MAX_CHUNK_BYTES && end - start > 1) {
      chunks.push(...(await splitPdf(slice)));
    } else {
      chunks.push(slice);
    }
  }
  return chunks;
}

async function extractPages(src: PDFDocument, start: number, end: number): Promise<Buffer> {
  const dest = await PDFDocument.create();
  const pageIndices = Array.from({ length: end - start }, (_, k) => start + k);
  const copied = await dest.copyPages(src, pageIndices);
  copied.forEach((p) => dest.addPage(p));
  const bytes = await dest.save();
  return Buffer.from(bytes);
}

async function parsePdfSingle(buffer: Buffer, chunkLabel?: string): Promise<ParsedDocument> {
  const base64 = buffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          } as any,
          { type: 'text', text: chunkLabel ? `${PARSE_PROMPT}\n\nNote: this is ${chunkLabel} of a larger PDF.` : PARSE_PROMPT },
        ],
      },
    ],
  });

  const text = response.content.find((c) => c.type === 'text')?.text || '';
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (fenceMatch ? fenceMatch[1] : text).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      docType: parsed.docType || 'unknown',
      summary: parsed.summary || '',
      takeoffs: Array.isArray(parsed.takeoffs) ? parsed.takeoffs : [],
      specs: Array.isArray(parsed.specs) ? parsed.specs : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    };
  } catch {
    throw new Error(`Claude returned invalid JSON. Raw response (first 800 chars): ${text.substring(0, 800)}`);
  }
}

function mergeParsedDocuments(docs: ParsedDocument[]): ParsedDocument {
  // Pick the most-specific docType (anything other than 'unknown' wins)
  const docType = docs.map((d) => d.docType).find((t) => t && t !== 'unknown') || docs[0]?.docType || 'unknown';
  const summary = docs.map((d) => d.summary).filter(Boolean).join(' ');

  const takeoffs = dedupeByKey(docs.flatMap((d) => d.takeoffs), (t) => `${(t.label || '').toLowerCase()}|${(t.unit || '').toUpperCase()}`);
  const specs = dedupeByKey(docs.flatMap((d) => d.specs), (s) => `${(s.section || '').toLowerCase()}|${(s.description || '').toLowerCase()}`);
  const concerns = dedupeByKey(docs.flatMap((d) => d.concerns), (c) => (c.description || '').toLowerCase());
  const lineItems = dedupeByKey(
    docs.flatMap((d) => d.lineItems),
    (li) => `${(li.material_key || '').toLowerCase()}|${(li.description || '').toLowerCase()}`
  );

  return { docType: docType as ParsedDocument['docType'], summary, takeoffs, specs, concerns, lineItems };
}

function dedupeByKey<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
