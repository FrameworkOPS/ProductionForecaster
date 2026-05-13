import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth';
import {
  listProjects, getProject, createProject, updateProject, deleteProject,
  uploadDocument, parseDocument, deleteDocument, bulkDeleteDocuments,
  createLineItem, updateLineItem, deleteLineItem,
  createSpec, deleteSpec,
  createConcern, deleteConcern,
  createTakeoff, updateTakeoff, deleteTakeoff,
  exportBidPdf,
} from '../controllers/estimatingController';

const uploadsDir = path.join(__dirname, '../../uploads');
// Ensure uploads directory exists at startup
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250MB

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${ts}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

// Multer error handler — converts cryptic LIMIT_FILE_SIZE into a clean message
function handleUploadError(err: any, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `File exceeds maximum size of ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
      });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
}

const router = Router();
router.use(authenticateToken);

// Projects
router.get('/', listProjects);
router.get('/:id', getProject);
router.post('/', createProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

// Documents
router.post('/:id/documents', upload.single('file'), handleUploadError, uploadDocument);
router.post('/:id/documents/:docId/parse', parseDocument);
router.delete('/:id/documents/:docId', deleteDocument);
router.post('/:id/documents/bulk-delete', bulkDeleteDocuments);

// Line items
router.post('/:id/line-items', createLineItem);
router.put('/:id/line-items/:itemId', updateLineItem);
router.delete('/:id/line-items/:itemId', deleteLineItem);

// Specs
router.post('/:id/specs', createSpec);
router.delete('/:id/specs/:specId', deleteSpec);

// Concerns
router.post('/:id/concerns', createConcern);
router.delete('/:id/concerns/:concernId', deleteConcern);

// Takeoffs
router.post('/:id/takeoffs', createTakeoff);
router.put('/:id/takeoffs/:takeoffId', updateTakeoff);
router.delete('/:id/takeoffs/:takeoffId', deleteTakeoff);

// Export
router.get('/:id/export/pdf', exportBidPdf);

export default router;
