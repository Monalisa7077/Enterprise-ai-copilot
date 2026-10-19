import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { deleteDocument, getDocument, listDocuments, uploadDocument } from '../controllers/documentController.js';
import { AppError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

const acceptedMimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname.replace(/\\/g, '/')).toLowerCase();
    if (acceptedMimeTypes[extension] !== file.mimetype) {
      return callback(new AppError('Only matching PDF, DOCX, and TXT files are supported', 400));
    }
    return callback(null, true);
  },
});

const router = Router();

router.use(requireAuth);
router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', listDocuments);
router.get('/:id', getDocument);
router.delete('/:id', deleteDocument);

export default router;
