import { spawn } from 'child_process';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface PageImage {
  page: number;
  width: number;
  height: number;
  data: string; // base64 PNG
}

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
}

async function pdfToImages(pdfPath: string, maxPages = 20): Promise<PageImage[]> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '../scripts/pdf_to_images.py');
    const proc = spawn('python3', [scriptPath, pdfPath, String(maxPages), '1.5']);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`PDF conversion failed: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result as PageImage[]);
        }
      } catch (e) {
        reject(new Error(`Failed to parse PDF conversion output: ${stdout}`));
      }
    });
  });
}

const PARSE_PROMPT = `You are an expert roofing and siding estimator. Analyze these PDF pages and extract ALL relevant estimating data.

EXTRACTION RULES:
1. Identify the document type: roofscope, sidingscope, spec_sheet (project manual/specifications), or plan_set (architectural drawings)
2. Extract EVERY measurement, area, linear footage, and count you can find
3. From spec sheets: extract ALL Division 7 (Thermal & Moisture Protection) content including:
   - Approved manufacturers and products
   - Material specifications (thickness, R-value, weight, gauge, finish)
   - Performance requirements (wind uplift, fire rating, warranty terms)
   - Application requirements
   - Submittal requirements
4. Flag areas of concern (complex flashings, penetrations, unusual details, spec conflicts)
5. Suggest line items with realistic unit prices for the Pacific Northwest market

Respond with ONLY valid JSON matching this exact structure:
{
  "docType": "roofscope" | "sidingscope" | "spec_sheet" | "plan_set" | "unknown",
  "summary": "one paragraph describing what was found",
  "takeoffs": [
    { "label": "Total Roof Area", "value": 588.66, "unit": "SQ", "category": "roof", "source": "RoofScope" }
  ],
  "specs": [
    { "section": "07 50 00 - Membrane Roofing", "spec_type": "material", "description": "TPO Membrane", "value": "60 mil, white, mechanically fastened" }
  ],
  "concerns": [
    { "description": "Complex parapet intersection at north elevation requires custom flashing detail", "severity": "high" }
  ],
  "lineItems": [
    { "category": "Roofing", "description": "TPO Membrane - 60 mil mechanically fastened", "quantity": 588.66, "unit": "SQ", "unit_price": 185.00, "waste_factor": 10, "notes": "Per spec 07 50 00", "sort_order": 1 }
  ]
}`;

export async function parsePdfDocument(pdfPath: string): Promise<ParsedDocument> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const pages = await pdfToImages(pdfPath);

  if (pages.length === 0) {
    throw new Error('No pages could be extracted from PDF');
  }

  // Build Claude message content with all page images
  const content: Anthropic.MessageParam['content'] = [
    { type: 'text', text: PARSE_PROMPT },
    ...pages.map((p) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: p.data,
      },
    })),
    {
      type: 'text',
      text: `The above ${pages.length} page(s) are from the PDF. Extract all estimating data as JSON.`,
    },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  });

  const text = response.content.find((c) => c.type === 'text')?.text || '';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const jsonStr = jsonMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return parsed as ParsedDocument;
  } catch {
    throw new Error(`Claude returned invalid JSON. Raw response: ${text.substring(0, 500)}`);
  }
}
