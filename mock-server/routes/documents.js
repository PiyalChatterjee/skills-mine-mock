/**
 * DOCUMENT STORAGE ROUTES  (document_api_v0.yaml)
 *
 * POST   /documents/resume                        → upload resume with applicant details
 * POST   /documents                                → upload a document (any owner/type)
 * GET    /documents/owner/:ownerType/:ownerId      → list documents for an owner
 * GET    /documents/:documentId                    → document + pre-signed view/download URLs
 * DELETE /documents/:documentId                     → soft-delete a document
 * GET    /documents/:documentId/download            → generate a pre-signed download URL
 *
 * Files are never actually persisted to S3 — this is a dummy storage layer that
 * inspects the uploaded file's MIME type / size and reacts the way the real
 * document-service would (accepting known types, rejecting unsupported ones,
 * enforcing the 20 MB limit).
 */

import { Router }  from 'express';
import multer      from 'multer';
import crypto       from 'node:crypto';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const ACCEPTED_MEDIA_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const OWNER_TYPES = new Set([
  'CANDIDATE', 'VISITOR', 'APPLICATION', 'JOB_PROFILE', 'CLIENT', 'MANAGEMENT', 'SYSTEM',
]);

const DOCUMENT_TYPES = new Set([
  'RESUME', 'CERTIFICATE', 'DEGREE', 'PORTFOLIO', 'IDENTITY_DOCUMENT',
  'COVER_LETTER', 'GENERATED_CV', 'ASSESSMENT', 'MANAGEMENT_REPORT', 'OTHER_SUPPORTING_DOCUMENT',
]);

const ROLE_MAP = {
  JOB_SEEKER: 'CANDIDATE', RECRUITER: 'RECRUITER', MANCO: 'MANCO', ADMIN: 'ADMIN', EXCO: 'EXCO',
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

function errorBody(status, error, message) {
  return { status, error, message };
}

// Wraps multer's single-file parsing so size-limit failures map to the OpenAPI error shape
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json(errorBody(413, 'FILE_TOO_LARGE', 'File size exceeds the maximum allowed limit of 20 MB'));
      }
      return res.status(400).json(errorBody(400, 'BAD_REQUEST', err.message));
    }
    next();
  });
}

// Per-file-type mock behaviour that a real OCR/AV pipeline would surface
function fileTypeNote(mediaType) {
  switch (mediaType) {
    case 'application/pdf':
      return { extractable: true, note: 'PDF accepted — text layer will be parsed by the OCR/AI pipeline.' };
    case 'image/png':
    case 'image/jpeg':
      return { extractable: true, note: 'Scanned image accepted — OCR quality may vary depending on resolution.' };
    case 'application/msword':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return { extractable: true, note: 'Word document accepted — structured text will be parsed directly.' };
    default:
      return { extractable: false, note: 'Unsupported file type.' };
  }
}

function buildCloudDetails(file) {
  return {
    document_version_id: crypto.randomUUID(),
    version_no: 1,
    s3_bucket: 'skillsmine-documents-mock',
    s3_key: `mock/${Date.now()}-${file.originalname}`,
    object_version_id: null,
    file_name: file.originalname,
    media_type: file.mimetype,
    size_bytes: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
}

function presignedUrl(documentId, cloud, disposition) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  return {
    url: `https://skillsmine-documents-mock.s3.amazonaws.com/${cloud.s3_key}?X-Amz-Signature=mock&response-content-disposition=${disposition}&documentId=${documentId}`,
    expires_at: expiresAt.toISOString(),
    ttl_seconds: 900,
  };
}

export function documentsRouter({ DB }) {
  const router = Router();

  // POST /documents/resume — resume upload with applicant details (must precede /:documentId)
  router.post('/resume', uploadSingle, (req, res) => {
    const { file } = req;
    if (!file) return res.status(400).json(errorBody(400, 'BAD_REQUEST', 'file is required'));

    const ownerType = req.body?.owner_type;
    if (!['CANDIDATE', 'VISITOR'].includes(ownerType))
      return res.status(400).json(errorBody(400, 'BAD_REQUEST', 'owner_type must be CANDIDATE or VISITOR'));

    if (!ACCEPTED_MEDIA_TYPES.has(file.mimetype))
      return res.status(415).json(errorBody(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PDF, PNG, JPEG, DOC, and DOCX files are accepted'));

    const ownerId = req.body?.owner_id ?? crypto.randomUUID();
    const cloud    = buildCloudDetails(file);
    const now      = new Date().toISOString();
    const { note } = fileTypeNote(file.mimetype);

    const document = {
      document_id: crypto.randomUUID(),
      owner_type: ownerType,
      owner_id_ref: ownerId,
      uploaded_by_id_ref: req.currentUser?.userId ?? ownerId,
      document_type: 'RESUME',
      title: req.body?.title || file.originalname,
      lifecycle_status: 'ACTIVE',
      created_by_role_code: ROLE_MAP[req.currentUser?.roles?.[0]] ?? ownerType,
      file_name: file.originalname,
      media_type: file.mimetype,
      size_bytes: file.size,
      created_at: now,
      updated_at: now,
      _cloud: cloud,
    };
    DB.documents.push(document);

    return res.status(201).json({
      owner_type: ownerType,
      owner_id_ref: ownerId,
      profile_status: 'INCOMPLETE',
      personal_details: null,
      education: null,
      experience: null,
      skills: [],
      languages: [],
      created_at: now,
      updated_at: now,
      document: {
        document_id: document.document_id,
        document_type: document.document_type,
        title: document.title,
        lifecycle_status: document.lifecycle_status,
        file_name: document.file_name,
        media_type: document.media_type,
        size_bytes: document.size_bytes,
      },
      _mock_note: note,
    });
  });

  // GET /documents/owner/:ownerType/:ownerId — list documents for an owner (must precede /:documentId)
  router.get('/owner/:ownerType/:ownerId', (req, res) => {
    const { ownerType, ownerId } = req.params;
    if (!OWNER_TYPES.has(ownerType))
      return res.status(400).json(errorBody(400, 'BAD_REQUEST', `owner_type must be one of ${[...OWNER_TYPES].join(', ')}`));

    const { document_type: documentTypeFilter } = req.query;
    let docs = DB.documents.filter(d => d.owner_type === ownerType && d.owner_id_ref === ownerId && d.lifecycle_status !== 'DELETED');
    if (documentTypeFilter) docs = docs.filter(d => d.document_type === documentTypeFilter);
    docs = [...docs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({
      documents: docs.map(d => ({
        document_id: d.document_id,
        document_type: d.document_type,
        title: d.title,
        lifecycle_status: d.lifecycle_status,
        media_type: d.media_type,
        size_bytes: d.size_bytes,
        file_name: d.file_name,
        created_at: d.created_at,
        updated_at: d.updated_at,
      })),
      total: docs.length,
    });
  });

  // POST /documents — generic document upload
  router.post('/', uploadSingle, (req, res) => {
    const { file } = req;
    if (!file) return res.status(400).json(errorBody(400, 'BAD_REQUEST', 'file is required'));

    const ownerType = req.body?.owner_type;
    if (!OWNER_TYPES.has(ownerType))
      return res.status(400).json(errorBody(400, 'BAD_REQUEST', `owner_type must be one of ${[...OWNER_TYPES].join(', ')}`));

    const ownerId = req.body?.owner_id;
    if (!ownerId) return res.status(400).json(errorBody(400, 'BAD_REQUEST', 'owner_id is required'));

    if (!ACCEPTED_MEDIA_TYPES.has(file.mimetype))
      return res.status(415).json(errorBody(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PDF, PNG, JPEG, DOC, and DOCX files are accepted'));

    const documentType = DOCUMENT_TYPES.has(req.body?.document_type) ? req.body.document_type : 'OTHER_SUPPORTING_DOCUMENT';
    const cloud = buildCloudDetails(file);
    const now   = new Date().toISOString();
    const { note } = fileTypeNote(file.mimetype);

    const document = {
      document_id: crypto.randomUUID(),
      owner_type: ownerType,
      owner_id_ref: ownerId,
      uploaded_by_id_ref: req.currentUser?.userId ?? ownerId,
      document_type: documentType,
      title: req.body?.title || file.originalname,
      lifecycle_status: 'ACTIVE',
      created_by_role_code: ROLE_MAP[req.currentUser?.roles?.[0]] ?? ownerType,
      file_name: file.originalname,
      media_type: file.mimetype,
      size_bytes: file.size,
      created_at: now,
      updated_at: now,
      _cloud: cloud,
    };
    DB.documents.push(document);

    const { _cloud, ...publicDocument } = document;
    return res.status(201).json({ ...publicDocument, _mock_note: note });
  });

  // GET /documents/:documentId — document + pre-signed view/download URLs
  router.get('/:documentId', (req, res) => {
    const doc = DB.documents.find(d => d.document_id === req.params.documentId);
    if (!doc || doc.lifecycle_status === 'DELETED')
      return res.status(404).json(errorBody(404, 'DOCUMENT_NOT_FOUND', 'No document found with the given ID'));

    return res.status(200).json({
      document_id: doc.document_id,
      title: doc.title,
      document_type: doc.document_type,
      lifecycle_status: doc.lifecycle_status,
      file_name: doc.file_name,
      media_type: doc.media_type,
      size_bytes: doc.size_bytes,
      created_at: doc.created_at,
      view_url: presignedUrl(doc.document_id, doc._cloud, 'inline'),
      download_url: presignedUrl(doc.document_id, doc._cloud, 'attachment'),
    });
  });

  // DELETE /documents/:documentId — soft delete
  router.delete('/:documentId', (req, res) => {
    const doc = DB.documents.find(d => d.document_id === req.params.documentId);
    if (!doc) return res.status(404).json(errorBody(404, 'DOCUMENT_NOT_FOUND', 'No document found with the given ID'));
    if (doc.lifecycle_status === 'DELETED')
      return res.status(409).json(errorBody(409, 'ALREADY_DELETED', 'Document is already in DELETED state'));

    doc.lifecycle_status = 'DELETED';
    doc.updated_at = new Date().toISOString();

    return res.status(200).json({
      document_id: doc.document_id,
      lifecycle_status: doc.lifecycle_status,
      updated_at: doc.updated_at,
    });
  });

  // GET /documents/:documentId/download — pre-signed download URL
  router.get('/:documentId/download', (req, res) => {
    const doc = DB.documents.find(d => d.document_id === req.params.documentId);
    if (!doc || doc.lifecycle_status === 'DELETED')
      return res.status(404).json(errorBody(404, 'DOCUMENT_NOT_FOUND', 'No document found with the given ID'));

    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    const { url, expires_at } = presignedUrl(doc.document_id, doc._cloud, disposition);

    return res.status(200).json({
      document_id: doc.document_id,
      file_name: doc.file_name,
      media_type: doc.media_type,
      presigned_url: url,
      expires_at,
      disposition,
    });
  });

  return router;
}
