/**
 * CRM ROUTES
 *
 * GET  /crm/clients             → list clients, optional ?status= filter, includes summary counts
 * POST /crm/clients/:id/notes   → add a note, optionally transition client status
 *
 * CRM status values:  hot_lead | warm_contact | cold_lead | needs_attention
 * Status transitions: cold_lead → warm_contact → hot_lead (or any via newStatus)
 */

import { Router } from 'express';

export function crmRouter({ DB }) {
  const router = Router();

  // Role guard: candidates cannot access CRM
  router.use((req, res, next) => {
    if (req.currentUser?.role === 'candidate')
      return res.status(403).json({ error: 'Access denied.' });
    next();
  });

  // GET /crm/clients  (supports ?status=hot_lead|warm_contact|cold_lead|needs_attention)
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
    };

    return res.status(200).json({ clients: data, total: results.length, page: pageNum, pageSize, summary });
  });

  // POST /crm/clients/:id/notes
  router.post('/clients/:id/notes', (req, res) => {
    const { id } = req.params;
    const client = DB.clients.find(c => c.clientId === id);
    if (!client) return res.status(404).json({ error: `Client ${id} not found.` });

    const { note, newStatus } = req.body ?? {};
    if (!note) return res.status(400).json({ error: 'note is required.' });

    const user    = req.currentUser;
    const noteObj = {
      noteId:   `note-${Date.now()}`,
      note,
      addedBy:  user ? `${user.firstName} ${user.lastName}` : 'Unknown',
      addedAt:  new Date().toISOString(),
    };
    if (!client.notes) client.notes = [];
    client.notes.push(noteObj);

    const previousStatus = client.status;
    if (newStatus) client.status = newStatus;

    return res.status(201).json({
      clientId:      id,
      noteId:        noteObj.noteId,
      previousStatus,
      currentStatus: client.status,
      message:       'Note added successfully.',
    });
  });

  return router;
}
