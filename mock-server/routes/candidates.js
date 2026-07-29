/**
 * CANDIDATE ROUTES
 *
 * POST /candidates/register            → self-registration, returns JWT
 * POST /candidates/cv/upload           → CV upload + OCR extraction response
 * GET  /candidates/cv/preview          → CV preview URL
 * PUT  /candidates/cv-builder/:step    → save a CV builder step
 * GET  /candidates/dashboard           → candidate home dashboard (live data)
 * GET  /candidates/applications        → my applications list
 * GET  /candidates/:id                 → candidate profile (recruiter / admin)
 * PUT  /candidates/:id                 → partial update of a candidate profile
 * GET  /candidates                     → recruiter candidate search
 */

import { Router } from 'express';

export function candidatesRouter({ DB, PIPELINE_STAGES, sessions, generateToken }) {
  const router = Router();

  // POST /candidates/register  (public)
  router.post('/register', (req, res) => {
    const { fullName, email, phone, password } = req.body ?? {};
    if (!fullName || !email || !password)
      return res.status(400).json({ error: 'fullName, email and password are required.' });

    const candidateId = `c${String(DB.candidates.length + 1).padStart(3, '0')}`;
    const newCandidate = {
      candidateId, fullName, email,
      phone: phone ?? '',
      role: 'candidate',
      registeredAt: new Date().toISOString(),
      profileComplete: 15,
    };
    DB.candidates.push(newCandidate);

    const token = generateToken({
      sub: candidateId, email, role: 'candidate',
      firstName: fullName.split(' ')[0],
      lastName:  fullName.split(' ').slice(1).join(' '),
      candidateId,
      permissions: ['VIEW_JOBS', 'APPLY_JOB', 'UPLOAD_CV', 'VIEW_DASHBOARD'],
    });
    sessions.set(token, newCandidate);
    return res.status(201).json({ candidateId, token, message: 'Registration successful.' });
  });

  // POST /candidates/cv/upload
  router.post('/cv/upload', (req, res) => {
    const user = req.currentUser;
    if (user?.role && user.role !== 'candidate' && user.role !== 'admin')
      return res.status(403).json({ error: 'Forbidden: only candidates may upload CVs.' });
    return res.status(200).json({
      documentId: `doc-${Math.floor(Math.random() * 90000) + 10000}`,
      uploadedAt: new Date().toISOString(),
      ocrExtracted: {
        fullName: user?.firstName ? `${user.firstName} ${user.lastName}` : 'Unknown',
        email:    user?.email ?? '',
        phone:    '+27 8X XXX XXXX',
        skills:   ['JavaScript', 'React', 'Node.js', 'SQL', 'Git'],
        education: [
          { institution: 'University of Witwatersrand', qualification: 'BSc Computer Science', year: 2018 },
        ],
        experience: [
          { company: 'Accenture', title: 'Software Developer', from: '2019-01', to: '2022-06' },
          { company: 'Discovery', title: 'Senior Developer',   from: '2022-07', to: 'Present' },
        ],
        summary: 'Experienced software developer with 5+ years in full-stack development.',
      },
      message: 'CV uploaded and parsed successfully.',
    });
  });

  // GET /candidates/cv/preview
  router.get('/cv/preview', (req, res) => {
    const user = req.currentUser;
    const candidate = DB.candidates.find(c => c.candidateId === user?.candidateId) ?? DB.candidates[0];
    return res.status(200).json({
      candidateId: candidate?.candidateId ?? 'c001',
      generatedAt: new Date().toISOString(),
      previewUrl:  `https://mock-cdn.skillsmine.com/cv-preview/${candidate?.candidateId ?? 'c001'}.pdf`,
      sections:    ['Personal Info', 'Skills', 'Education', 'Experience', 'Summary'],
    });
  });

  // PUT /candidates/cv-builder/:step
  router.put('/cv-builder/:step', (req, res) => {
    const { step } = req.params;
    const validSteps = ['personal', 'skills', 'education', 'experience', 'summary', 'preferences'];
    if (!validSteps.includes(step))
      return res.status(400).json({ error: `Invalid step. Valid steps: ${validSteps.join(', ')}` });
    return res.status(200).json({
      step,
      savedAt:              new Date().toISOString(),
      nextStep:             validSteps[validSteps.indexOf(step) + 1] ?? null,
      profileCompleteness:  Math.min(100, (validSteps.indexOf(step) + 1) * 17),
      message:              `CV builder step '${step}' saved successfully.`,
    });
  });

  // GET /candidates/dashboard
  router.get('/dashboard', (req, res) => {
    const user      = req.currentUser;
    const cid       = user?.candidateId ?? 'c001';
    const apps      = DB.applications.filter(a => a.candidateId === cid);
    const inProgress = apps.filter(a => !['Closed', 'Offer'].includes(a.currentStage)).length;
    const candidate = DB.candidates.find(c => c.candidateId === cid) ?? DB.candidates[0];
    const jobs      = DB.jobs.filter(j => j.status === 'Open').slice(0, 3).map(j => ({
      id: j.jobId, title: j.title, company: j.company,
      location: j.location, matchScore: Math.floor(Math.random() * 25) + 70,
      salary: j.salaryRange,
    }));
    return res.status(200).json({
      candidateId:           cid,
      profileCompleteness:   candidate?.profileComplete ?? 78,
      applicationCount:      apps.length,
      applicationsInProgress: inProgress,
      savedJobs:             Math.floor(Math.random() * 6) + 2,
      recruitersViewed:      Math.floor(Math.random() * 10) + 5,
      recommendedJobs:       jobs,
      currentApplications:   apps.slice(0, 5).map(a => ({
        applicationId: a.applicationId,
        jobTitle:      a.jobTitle,
        company:       a.company,
        stage:         a.currentStage,
        appliedDate:   a.appliedDate,
      })),
      weeklyActivity: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => ({
        day,
        applications: Math.floor(Math.random() * 3),
        profileViews: Math.floor(Math.random() * 8),
      })),
    });
  });

  // GET /candidates/applications
  router.get('/applications', (req, res) => {
    const user = req.currentUser;
    const cid  = user?.candidateId ?? 'c001';
    const apps = DB.applications.filter(a => a.candidateId === cid);
    return res.status(200).json({ applications: apps, total: apps.length });
  });

  // GET /candidates/:id  (recruiter / admin)
  router.get('/:id', (req, res) => {
    const { id } = req.params;
    const candidate = DB.candidates.find(c => c.candidateId === id);
    if (!candidate) return res.status(404).json({ error: `Candidate ${id} not found.` });
    return res.status(200).json(candidate);
  });

  // PUT /candidates/:id  (partial update)
  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const idx = DB.candidates.findIndex(c => c.candidateId === id);
    if (idx === -1) return res.status(404).json({ error: `Candidate ${id} not found.` });

    const IMMUTABLE = ['candidateId', 'role', 'registeredAt'];
    const updates = { ...req.body };
    IMMUTABLE.forEach(k => delete updates[k]);

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No updatable fields provided.' });

    DB.candidates[idx] = { ...DB.candidates[idx], ...updates };
    return res.status(200).json(DB.candidates[idx]);
  });

  // GET /candidates  (recruiter search)
  router.get('/', (req, res) => {
    const { q, skills, location, page = 1, limit = 20 } = req.query;
    let results = [...DB.candidates];
    if (q) results = results.filter(c =>
      c.fullName?.toLowerCase().includes(q.toLowerCase()) ||
      c.currentTitle?.toLowerCase().includes(q.toLowerCase())
    );
    if (skills) {
      const skillArr = skills.split(',').map(s => s.trim().toLowerCase());
      results = results.filter(c =>
        skillArr.some(sk => (c.skills ?? []).map(s => s.toLowerCase()).includes(sk))
      );
    }
    if (location) results = results.filter(c =>
      c.location?.toLowerCase().includes(location.toLowerCase())
    );
    const pageNum  = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const data     = results.slice((pageNum - 1) * pageSize, pageNum * pageSize);
    return res.status(200).json({ candidates: data, total: results.length, page: pageNum, pageSize });
  });

  return router;
}
