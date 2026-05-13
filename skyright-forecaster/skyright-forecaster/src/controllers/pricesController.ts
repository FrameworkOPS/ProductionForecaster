import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';

// kind: 'material' | 'labor'  → table: material_prices | labor_prices
function tableFor(kind: string): string {
  if (kind === 'material') return 'material_prices';
  if (kind === 'labor') return 'labor_prices';
  throw new AppError('Unknown price kind. Use "material" or "labor".', 400);
}

export const listPrices = asyncHandler(async (req: Request, res: Response) => {
  const kind = (req.query.kind as string) || 'material';
  const table = tableFor(kind);
  const result = await query(
    `SELECT * FROM ${table} ORDER BY category, description`
  );
  res.json({ success: true, data: result.rows });
});

export const createPrice = asyncHandler(async (req: Request, res: Response) => {
  const kind = (req.body.kind as string) || 'material';
  const table = tableFor(kind);
  const { material_key, category, description, unit, unit_cost, vendor, notes } = req.body;
  if (!material_key || !category || !description || !unit || unit_cost == null) {
    throw new AppError('material_key, category, description, unit, unit_cost are required', 400);
  }
  const cols = kind === 'material'
    ? '(material_key, category, description, unit, unit_cost, vendor, notes)'
    : '(material_key, category, description, unit, unit_cost, notes)';
  const placeholders = kind === 'material' ? '($1,$2,$3,$4,$5,$6,$7)' : '($1,$2,$3,$4,$5,$6)';
  const params = kind === 'material'
    ? [material_key, category, description, unit, unit_cost, vendor || null, notes || null]
    : [material_key, category, description, unit, unit_cost, notes || null];
  const result = await query(
    `INSERT INTO ${table} ${cols} VALUES ${placeholders} RETURNING *`,
    params
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const updatePrice = asyncHandler(async (req: Request, res: Response) => {
  const kind = (req.body.kind as string) || (req.query.kind as string) || 'material';
  const table = tableFor(kind);
  const { id } = req.params;
  const { material_key, category, description, unit, unit_cost, vendor, notes } = req.body;
  const result = await query(
    `UPDATE ${table} SET
      material_key = COALESCE($1, material_key),
      category     = COALESCE($2, category),
      description  = COALESCE($3, description),
      unit         = COALESCE($4, unit),
      unit_cost    = COALESCE($5, unit_cost),
      ${kind === 'material' ? 'vendor = COALESCE($6, vendor),' : ''}
      notes        = COALESCE($${kind === 'material' ? '7' : '6'}, notes),
      last_updated = NOW()
     WHERE id = $${kind === 'material' ? '8' : '7'} RETURNING *`,
    kind === 'material'
      ? [material_key, category, description, unit, unit_cost, vendor, notes, id]
      : [material_key, category, description, unit, unit_cost, notes, id]
  );
  if (!result.rows[0]) throw new AppError('Price not found', 404);
  res.json({ success: true, data: result.rows[0] });
});

export const deletePrice = asyncHandler(async (req: Request, res: Response) => {
  const kind = (req.query.kind as string) || 'material';
  const table = tableFor(kind);
  const { id } = req.params;
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  res.json({ success: true });
});

// Re-price all line items in a project (re-runs lookup; useful after price-db edits)
export const repriceProject = asyncHandler(async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const items = await query(
    `SELECT id, description, unit, material_key FROM estimate_line_items WHERE project_id = $1`,
    [projectId]
  );
  let updated = 0;
  let stillFlagged = 0;
  for (const it of items.rows) {
    let priced: { unit_cost: number } | null = null;
    if (it.material_key) {
      const m = await query('SELECT unit_cost FROM material_prices WHERE material_key = $1', [it.material_key]);
      if (m.rows[0]) priced = { unit_cost: parseFloat(m.rows[0].unit_cost) };
      else {
        const l = await query('SELECT unit_cost FROM labor_prices WHERE material_key = $1', [it.material_key]);
        if (l.rows[0]) priced = { unit_cost: parseFloat(l.rows[0].unit_cost) };
      }
    }
    if (priced) {
      await query(
        'UPDATE estimate_line_items SET unit_price = $1, price_flagged = false WHERE id = $2',
        [priced.unit_cost, it.id]
      );
      updated++;
    } else {
      await query('UPDATE estimate_line_items SET price_flagged = true WHERE id = $1', [it.id]);
      stillFlagged++;
    }
  }
  res.json({ success: true, data: { updated, stillFlagged } });
});
