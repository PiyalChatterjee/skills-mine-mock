/**
 * JOB POSTS ROUTES
 *
 * GET    /job-posts              → all mandates from mandates.json (no pagination)
 * GET    /job-posts/:mandateId   → single mandate by mandateId
 * POST   /job-posts              → create a new job post
 * PUT    /job-posts/:mandateId   → update a mandate by mandateId
 * DELETE /job-posts/:mandateId   → delete a mandate by mandateId
 *
 * Optional query params for GET /job-posts:
 *   status       – filter by mandate status  (e.g. POSTED | DRAFT)
 *   priority     – filter by priority        (e.g. HIGH | MEDIUM | CRITICAL)
 *   recruiterId  – filter by recruiterId     (e.g. r001)
 *   search       – partial match on title or client name (case-insensitive)
 */

import { Router } from 'express';

export function jobPostsRouter({ DB, saveDataset }) {
  const router = Router();

  // GET /job-posts
  router.get('/', (req, res) => {
    const { status, priority, recruiterId, search } = req.query;

    let results = [...DB.mandates];

    if (status) {
      results = results.filter(m => m.status?.toUpperCase() === status.toUpperCase());
    }

    if (priority) {
      results = results.filter(m => m.priority?.toUpperCase() === priority.toUpperCase());
    }

    if (recruiterId) {
      results = results.filter(m => m.recruiterId === recruiterId);
    }

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        m =>
          m.title?.toLowerCase().includes(q) ||
          m.client?.toLowerCase().includes(q),
      );
    }

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Job posts retrieved.',
      data:       results,
    });
  });

  // POST /job-posts
  router.post('/', (req, res) => {
    const body = req.body ?? {};

    // Generate a sequential mandateId  e.g. MND006
    const nextNum  = DB.mandates.length + 1;
    const mandateId = `MND${String(nextNum).padStart(3, '0')}`;
    const jobId     = `j${String(nextNum).padStart(3, '0')}`;
    const today     = new Date().toISOString().split('T')[0];

    const newMandate = {
      mandateId,
      jobId,
      title:            body.positionTitle    ?? '',
      client:           body.companyName      ?? '',
      clientId:         '',
      recruiterId:      body.recruiterId      ?? '',
      recruiterName:    body.recruiterName    ?? '',
      industry:         Array.isArray(body.industries) && body.industries.length > 0
        ? body.industries[0]
        : '',
      industries:       Array.isArray(body.industries) ? body.industries : [],
      status:           'POSTED',
      priority:         body.priority ? body.priority.toUpperCase() : 'MEDIUM',
      openDate:         today,
      targetCloseDate:  body.fillByDate       ?? today,
      salaryBand:       body.salary
        ? `R${Number(body.salary.minimum).toLocaleString()} – R${Number(body.salary.maximum).toLocaleString()}`
        : '',
      salaryMin:        body.salary?.minimum  ?? 0,
      salaryMax:        body.salary?.maximum  ?? 0,
      location:         body.location         ?? '',
      workType:         body.workType         ?? '',
      employmentType:   body.employmentType   ?? '',
      experienceLevel:  body.experienceLevel  ?? '',
      eeTarget:         false,
      eeRequirement:    '',
      jobDescription:   body.jobDescription   ?? '',
      requirements:     body.requirements
        ? body.requirements.split('\n').map(s => s.trim()).filter(Boolean)
        : [],
      responsibilities: body.responsibilities
        ? body.responsibilities.split('\n').map(s => s.trim()).filter(Boolean)
        : [],
      benefits:         body.benefits
        ? body.benefits.split('\n').map(s => s.trim()).filter(Boolean)
        : [],
      skills:           Array.isArray(body.skills)    ? body.skills    : [],
      jobBoards:        Array.isArray(body.jobBoards) ? body.jobBoards : [],
      applicantCount:   0,
      shortlistedCount: 0,
      interviewCount:   0,
      pipeline:         {},
    };

    DB.mandates.push(newMandate);
    saveDataset('mandates', DB.mandates);

    return res.status(201).json({
      success:    true,
      statusCode: 201,
      message:    'Job post created.',
      data:       { mandateId },
    });
  });

  // GET /job-posts/:mandateId
  router.get('/:mandateId', (req, res) => {
    const { mandateId } = req.params;
    const mandate = DB.mandates.find(m => m.mandateId === mandateId);

    if (!mandate) {
      return res.status(404).json({
        success:    false,
        statusCode: 404,
        message:    `Job post with mandateId "${mandateId}" not found.`,
      });
    }

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Job post retrieved.',
      data:       mandate,
    });
  });

  // PUT /job-posts/:mandateId
  router.put('/:mandateId', (req, res) => {
    const { mandateId } = req.params;
    const idx = DB.mandates.findIndex(m => m.mandateId === mandateId);

    if (idx === -1) {
      return res.status(404).json({
        success:    false,
        statusCode: 404,
        message:    `Job post with mandateId "${mandateId}" not found.`,
      });
    }

    const body = req.body ?? {};

    // Map flat request body fields back onto the stored mandate shape
    const updated = {
      ...DB.mandates[idx],
      title:           body.positionTitle    ?? DB.mandates[idx].title,
      client:          body.companyName      ?? DB.mandates[idx].client,
      location:        body.location         ?? DB.mandates[idx].location,
      targetCloseDate: body.fillByDate       ?? DB.mandates[idx].targetCloseDate,
      workType:        body.workType         ?? DB.mandates[idx].workType,
      employmentType:  body.employmentType   ?? DB.mandates[idx].employmentType,
      experienceLevel: body.experienceLevel  ?? DB.mandates[idx].experienceLevel,
      priority:        body.priority         ? body.priority.toUpperCase() : DB.mandates[idx].priority,
      salaryMin:       body.salary?.minimum  ?? DB.mandates[idx].salaryMin,
      salaryMax:       body.salary?.maximum  ?? DB.mandates[idx].salaryMax,
      salaryBand:      body.salary
        ? `R${Number(body.salary.minimum).toLocaleString()} – R${Number(body.salary.maximum).toLocaleString()}`
        : DB.mandates[idx].salaryBand,
      jobDescription:  body.jobDescription   ?? DB.mandates[idx].jobDescription,
      requirements:    body.requirements
        ? body.requirements.split('\n').map(s => s.trim()).filter(Boolean)
        : DB.mandates[idx].requirements,
      responsibilities: body.responsibilities
        ? body.responsibilities.split('\n').map(s => s.trim()).filter(Boolean)
        : DB.mandates[idx].responsibilities,
      benefits:        body.benefits
        ? body.benefits.split('\n').map(s => s.trim()).filter(Boolean)
        : DB.mandates[idx].benefits,
      skills:          body.skills           ?? DB.mandates[idx].skills,
      industries:      body.industries       ?? DB.mandates[idx].industries,
      industry:        Array.isArray(body.industries) && body.industries.length > 0
        ? body.industries[0]
        : DB.mandates[idx].industry,
      jobBoards:       body.jobBoards        ?? DB.mandates[idx].jobBoards,
    };

    DB.mandates[idx] = updated;
    saveDataset('mandates', DB.mandates);

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Job post updated.',
      data:       { mandateId },
    });
  });

  // DELETE /job-posts/:mandateId
  router.delete('/:mandateId', (req, res) => {
    const { mandateId } = req.params;
    const idx = DB.mandates.findIndex(m => m.mandateId === mandateId);

    if (idx === -1) {
      return res.status(404).json({
        success:    false,
        statusCode: 404,
        message:    `Job post with mandateId "${mandateId}" not found.`,
      });
    }

    DB.mandates.splice(idx, 1);
    saveDataset('mandates', DB.mandates);

    return res.status(200).json({
      success:    true,
      statusCode: 200,
      message:    'Job post deleted.',
      data:       { mandateId },
    });
  });

  return router;
}
