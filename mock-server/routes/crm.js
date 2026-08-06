/**
 * CRM ROUTES  (v2 contract)
 *
 * GET  /api/v1/crm/clients              → list clients with summary; optional ?status= filter
 * POST /api/v1/crm/clients/:clientId/notes → add a note / transition status
 *
 * CRM status values:  hot_lead | warm_contact | cold_lead | needs_attention
 */

import { Router } from 'express';

export function crmRouter({ DB }) {
  const router = Router();

  // Role guard: candidates cannot access CRM
  router.use((req, res, next) => {
    const role = req.currentUser?.role ?? (req.currentUser?.roles?.[0] ?? '');
    if (['JOB_SEEKER', 'candidate'].includes(role))
      return res.status(403).json({ success: false, statusCode: 403, message: 'Access denied.' });
    next();
  });

  // GET /api/v1/crm/clients
  router.get('/clients', (req, res) => {
    const { status, page = 1, limit = 20 } = req.query;
    let results = [...DB.clients];
    if (status) results = results.filter(c => c.status?.toLowerCase() === status.toLowerCase());

    const pageNum  = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const data     = results.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    const summary = {
      hot_lead:        DB.clients.filter(c => c.status === 'hot_lead').length,
      warm_contact:    DB.clients.filter(c => c.status === 'warm_contact').length,
      cold_lead:       DB.clients.filter(c => c.status === 'cold_lead').length,
      needs_attention: DB.clients.filter(c => c.status === 'needs_attention').length,
      total:           DB.clients.length,
    };

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'CRM clients retrieved.',
      data: {
        summary,
        clients: data,
        pagination: {
          page:       pageNum,
          pageSize,
          total:      results.length,
          totalPages: Math.ceil(results.length / pageSize),
        },
      },
    });
  });

  // POST /api/v1/crm/clients/:clientId/notes
  router.post('/clients/:clientId/notes', (req, res) => {
    const { clientId } = req.params;
    const client = DB.clients.find(c => c.clientId === clientId);
    if (!client) return res.status(404).json({ success: false, statusCode: 404, message: `Client ${clientId} not found.` });

    const { note, noteType, newStatus } = req.body ?? {};
    if (!note) return res.status(400).json({ success: false, statusCode: 400, message: 'note is required.' });

    const user    = req.currentUser;
    const noteObj = {
      noteId:   `note-${Date.now()}`,
      note,
      noteType: noteType ?? 'GENERAL',
      addedBy:  user ? `${user.firstName} ${user.lastName}` : 'Unknown',
      addedAt:  new Date().toISOString(),
    };
    if (!client.notes) client.notes = [];
    client.notes.push(noteObj);

    const previousStatus = client.status;
    if (newStatus) client.status = newStatus;

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Note added successfully.',
      data: {
        clientId,
        noteId:         noteObj.noteId,
        noteType:       noteObj.noteType,
        addedBy:        noteObj.addedBy,
        addedAt:        noteObj.addedAt,
        previousStatus,
        currentStatus:  client.status,
        totalNotes:     client.notes.length,
      },
    });
  });

  return router;
}
