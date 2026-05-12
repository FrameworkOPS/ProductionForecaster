import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { parsePdfDocument } from '../services/pdfParserService';
import { generateBidPdf } from '../services/bidGeneratorService';

// ── PROJECTS ─────────────────────────────────────────────────────────────────

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const result = await query(`
    SELECT p.*,
      COUNT(DISTINCT d.id) AS doc_count,
      COUNT(DISTINCT li.id) AS line_item_count,
      COALESCE(SUM(li.quantity * li.unit_price), 0) AS total_bid
    FROM estimate_projects p
    LEFT JOIN estimate_documents d ON d.project_id = p.id
    LEFT JOIN estimate_line_items li ON li.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `);
  res.json({ success: true, data: result.rows });
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const [project, docs, specs, lineItems, concerns, takeoffs] = await Promise.all([
    query('SELECT * FROM estimate_projects WHERE id = $1', [id]),
    query('SELECT * FROM estimate_documents WHERE project_id = $1 ORDER BY created_at', [id]),
    query('SELECT * FROM estimate_specs WHERE project_id = $1 ORDER BY section, spec_type', [id]),
    query('SELECT * FROM estimate_line_items WHERE project_id = $1 ORDER BY category, sort_order', [id]),
    query('SELECT * FROM estimate_concerns WHERE project_id = $1 ORDER BY severity DESC, created_at', [id]),
    query('SELECT * FROM estimate_takeoffs WHERE project_id = $1 ORDER BY category, sort_order', [id]),
  ]);

  if (!project.rows[0]) throw new AppError('Project not found', 404);

  res.json({
    success: true,
    data: {
      ...project.rows[0],
      documents: docs.rows,
      specs: specs.rows,
      lineItems: lineItems.rows,
      concerns: concerns.rows,
      takeoffs: takeoffs.rows,
    },
  });
});

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const { name, project_address, gc_name, bid_date, project_type, notes } = req.body;
  if (!name) throw new AppError('Project name is required', 400);

  const result = await query(
    `INSERT INTO estimate_projects (name, project_address, gc_name, bid_date, project_type, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, project_address, gc_name, bid_date || null, project_type || 'roofing', notes]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, project_address, gc_name, bid_date, project_type, status, notes } = req.body;

  const result = await query(
    `UPDATE estimate_projects SET
      name = COALESCE($1, name),
      project_address = COALESCE($2, project_address),
      gc_name = COALESCE($3, gc_name),
      bid_date = COALESCE($4, bid_date),
      project_type = COALESCE($5, project_type),
      status = COALESCE($6, status),
      notes = COALESCE($7, notes),
      updated_at = NOW()
    WHERE id = $8 RETURNING *`,
    [name, project_address, gc_name, bid_date || null, project_type, status, notes, id]
  );
  if (!result.rows[0]) throw new AppError('Project not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  // Clean up uploaded files
  const docs = await query('SELECT file_path FROM estimate_documents WHERE project_id = $1', [id]);
  for (const doc of docs.rows) {
    try { fs.unlinkSync(doc.file_path); } catch {}
  }
  await query('DELETE FROM estimate_projects WHERE id = $1', [id]);
  res.json({ success: true });
});

// ── DOCUMENTS / UPLOAD ────────────────────────────────────────────────────────

export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const file = (req as any).file;
  const docType = req.body.doc_type || 'unknown';

  if (!file) throw new AppError('No file uploaded', 400);

  const result = await query(
    `INSERT INTO estimate_documents (project_id, file_name, file_path, doc_type)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [projectId, file.originalname, file.path, docType]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const parseDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId, docId } = req.params;

  const docResult = await query(
    'SELECT * FROM estimate_documents WHERE id = $1 AND project_id = $2',
    [docId, projectId]
  );
  if (!docResult.rows[0]) throw new AppError('Document not found', 404);

  const doc = docResult.rows[0];
  if (!fs.existsSync(doc.file_path)) throw new AppError('File not found on disk', 404);

  const parsed = await parsePdfDocument(doc.file_path);

  // Store parsed data on the document
  await query(
    'UPDATE estimate_documents SET parsed = true, parsed_data = $1, parsed_at = NOW(), doc_type = $2 WHERE id = $3',
    [JSON.stringify(parsed), parsed.docType, docId]
  );

  // Upsert takeoffs
  if (parsed.takeoffs?.length) {
    for (let i = 0; i < parsed.takeoffs.length; i++) {
      const t = parsed.takeoffs[i];
      await query(
        `INSERT INTO estimate_takeoffs (project_id, label, value, unit, category, source, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [projectId, t.label, t.value, t.unit, t.category, t.source, i]
      );
    }
  }

  // Upsert specs
  if (parsed.specs?.length) {
    for (const s of parsed.specs) {
      await query(
        `INSERT INTO estimate_specs (project_id, section, spec_type, description, value, source_doc_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [projectId, s.section, s.spec_type, s.description, s.value, docId]
      );
    }
  }

  // Upsert line items
  if (parsed.lineItems?.length) {
    for (let i = 0; i < parsed.lineItems.length; i++) {
      const li = parsed.lineItems[i];
      await query(
        `INSERT INTO estimate_line_items (project_id, category, description, quantity, unit, unit_price, waste_factor, notes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [projectId, li.category, li.description, li.quantity, li.unit, li.unit_price, li.waste_factor, li.notes, i]
      );
    }
  }

  // Upsert concerns
  if (parsed.concerns?.length) {
    for (const c of parsed.concerns) {
      await query(
        `INSERT INTO estimate_concerns (project_id, description, severity)
         VALUES ($1, $2, $3)`,
        [projectId, c.description, c.severity]
      );
    }
  }

  res.json({ success: true, data: parsed });
});

export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId, docId } = req.params;
  const doc = await query('SELECT * FROM estimate_documents WHERE id = $1 AND project_id = $2', [docId, projectId]);
  if (doc.rows[0]) {
    try { fs.unlinkSync(doc.rows[0].file_path); } catch {}
    await query('DELETE FROM estimate_documents WHERE id = $1', [docId]);
  }
  res.json({ success: true });
});

// ── LINE ITEMS ────────────────────────────────────────────────────────────────

export const createLineItem = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { category, description, quantity, unit, unit_price, waste_factor, notes, sort_order } = req.body;
  if (!description) throw new AppError('Description is required', 400);

  const result = await query(
    `INSERT INTO estimate_line_items (project_id, category, description, quantity, unit, unit_price, waste_factor, notes, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [projectId, category, description, quantity || 0, unit, unit_price || 0, waste_factor || 0, notes, sort_order || 0]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const updateLineItem = asyncHandler(async (req: Request, res: Response) => {
  const { itemId } = req.params;
  const { category, description, quantity, unit, unit_price, waste_factor, notes, sort_order } = req.body;

  const result = await query(
    `UPDATE estimate_line_items SET
      category = COALESCE($1, category),
      description = COALESCE($2, description),
      quantity = COALESCE($3, quantity),
      unit = COALESCE($4, unit),
      unit_price = COALESCE($5, unit_price),
      waste_factor = COALESCE($6, waste_factor),
      notes = COALESCE($7, notes),
      sort_order = COALESCE($8, sort_order)
    WHERE id = $9 RETURNING *`,
    [category, description, quantity, unit, unit_price, waste_factor, notes, sort_order, itemId]
  );
  if (!result.rows[0]) throw new AppError('Line item not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const deleteLineItem = asyncHandler(async (req: Request, res: Response) => {
  const { itemId } = req.params;
  await query('DELETE FROM estimate_line_items WHERE id = $1', [itemId]);
  res.json({ success: true });
});

// ── SPECS ─────────────────────────────────────────────────────────────────────

export const createSpec = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { section, spec_type, description, value } = req.body;

  const result = await query(
    `INSERT INTO estimate_specs (project_id, section, spec_type, description, value)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [projectId, section, spec_type, description, value]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const deleteSpec = asyncHandler(async (req: Request, res: Response) => {
  const { specId } = req.params;
  await query('DELETE FROM estimate_specs WHERE id = $1', [specId]);
  res.json({ success: true });
});

// ── CONCERNS ─────────────────────────────────────────────────────────────────

export const createConcern = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { description, severity } = req.body;

  const result = await query(
    `INSERT INTO estimate_concerns (project_id, description, severity)
     VALUES ($1, $2, $3) RETURNING *`,
    [projectId, description, severity || 'medium']
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const deleteConcern = asyncHandler(async (req: Request, res: Response) => {
  const { concernId } = req.params;
  await query('DELETE FROM estimate_concerns WHERE id = $1', [concernId]);
  res.json({ success: true });
});

// ── TAKEOFFS ─────────────────────────────────────────────────────────────────

export const createTakeoff = asyncHandler(async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { label, value, unit, category, source, sort_order } = req.body;

  const result = await query(
    `INSERT INTO estimate_takeoffs (project_id, label, value, unit, category, source, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [projectId, label, value, unit, category, source, sort_order || 0]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const updateTakeoff = asyncHandler(async (req: Request, res: Response) => {
  const { takeoffId } = req.params;
  const { label, value, unit, category } = req.body;

  const result = await query(
    `UPDATE estimate_takeoffs SET
      label = COALESCE($1, label),
      value = COALESCE($2, value),
      unit = COALESCE($3, unit),
      category = COALESCE($4, category)
    WHERE id = $5 RETURNING *`,
    [label, value, unit, category, takeoffId]
  );
  res.json({ success: true, data: result.rows[0] });
});

export const deleteTakeoff = asyncHandler(async (req: Request, res: Response) => {
  const { takeoffId } = req.params;
  await query('DELETE FROM estimate_takeoffs WHERE id = $1', [takeoffId]);
  res.json({ success: true });
});

// ── BID PDF EXPORT ────────────────────────────────────────────────────────────

export const exportBidPdf = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const [project, specs, lineItems, concerns, takeoffs] = await Promise.all([
    query('SELECT * FROM estimate_projects WHERE id = $1', [id]),
    query('SELECT * FROM estimate_specs WHERE project_id = $1 ORDER BY section, spec_type', [id]),
    query('SELECT * FROM estimate_line_items WHERE project_id = $1 ORDER BY category, sort_order', [id]),
    query('SELECT * FROM estimate_concerns WHERE project_id = $1 ORDER BY severity DESC', [id]),
    query('SELECT * FROM estimate_takeoffs WHERE project_id = $1 ORDER BY category, sort_order', [id]),
  ]);

  if (!project.rows[0]) throw new AppError('Project not found', 404);

  generateBidPdf(
    {
      project: project.rows[0],
      takeoffs: takeoffs.rows,
      specs: specs.rows,
      lineItems: lineItems.rows.map((li: any) => ({
        ...li,
        line_total: String(parseFloat(li.quantity || 0) * parseFloat(li.unit_price || 0)),
      })),
      concerns: concerns.rows,
    },
    res
  );
});
