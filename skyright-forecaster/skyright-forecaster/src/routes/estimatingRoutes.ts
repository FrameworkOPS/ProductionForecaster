import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticateToken } from '../middleware/auth';
import {
  listProjects, getProject, createProject, updateProject, deleteProject,
  uploadDocument, parseDocument, deleteDocument,
  createLineItem, updateLineItem, deleteLineItem,
  createSpec, deleteSpec,
  createConcern, deleteConcern,
  createTakeoff, updateTakeoff, deleteTakeoff,
  exportBidPdf,
} from '../controllers/estimatingController';

const uploadsDir = path.join(__dirname, '../../uploads');

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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

const router = Router();
router.use(authenticateToken);

// Projects
router.get('/', listProjects);
router.get('/:id', getProject);
router.post('/', createProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

// Documents
router.post('/:id/documents', upload.single('file'), uploadDocument);
router.post('/:id/documents/:docId/parse', parseDocument);
router.delete('/:id/documents/:docId', deleteDocument);

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
