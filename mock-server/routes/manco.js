/**
 * MANCO ROUTES  (v2 contract)
 *
 * GET /api/v1/manco/:mancoId/dashboard           → platform KPIs + alerts + recruiters
 * GET /api/manco/recruiters/:id/performance      → individual recruiter KPI metrics
 */

import { Router } from 'express';

export function mancoRouter({ DB }) {
  const router = Router();

  // Role guard: only manco / admin may access these routes
  router.use((req, res, next) => {
    const role  = req.currentUser?.role ?? '';
    const roles = req.currentUser?.roles ?? [];
    const hasAccess = ['manco', 'admin', 'MANCO', 'ADMIN'].some(r => role === r || roles.includes(r));
    if (!hasAccess)
      return res.status(403).json({ success: false, statusCode: 403, message: 'Access denied: MANCO or admin role required.' });
    next();
  });

  // GET /api/v1/manco/:mancoId/dashboard
  router.get('/:mancoId/dashboard', (req, res) => {
    const { mancoId } = req.params;
    const { sortedBy = 'placements' } = req.query;

    const recruiters = DB.recruiters.slice(0, 10).map(r => ({
      recruiterId:    r.recruiterId,
      name:           r.fullName,
      email:          r.email,
      specialisation: r.specialisation ?? [],
      metrics: {
        placements:     r.metrics?.placements ?? 0,
        activeRoles:    r.metrics?.activeRoles ?? 0,
        candidates:     r.metrics?.candidates ?? 0,
        conversionRate: r.metrics?.conversionRate ?? 0,
      },
      activeMandates: DB.mandates.filter(m => m.recruiterId === r.recruiterId && m.status === 'ACTIVE').length,
    }));

    // Sort recruiters by requested metric
    if (['placements', 'activeRoles', 'candidates', 'conversionRate'].includes(sortedBy)) {
      recruiters.sort((a, b) => (b.metrics[sortedBy] ?? 0) - (a.metrics[sortedBy] ?? 0));
    }

    const alerts = [];
    DB.mandates.forEach(m => {
      const daysOpen = m.openDate
        ? Math.floor((Date.now() - new Date(m.openDate).getTime()) / 86400000)
        : 0;
      if (daysOpen > 45 && m.status === 'ACTIVE') {
        alerts.push({
          alertId:   `ALT-${m.mandateId}`,
          type:      'MANDATE_STALE',
          severity:  'WARNING',
          message:   `Mandate ${m.title} at ${m.client} has been open for ${daysOpen} days.`,
          mandateId: m.mandateId,
          daysOpen,
        });
      }
    });

    // EE compliance alerts
    DB.mandates
      .filter(m => m.eeTarget && m.shortlistedCount === 0 && m.status === 'ACTIVE')
      .forEach(m => {
        alerts.push({
          alertId:   `ALT-EE-${m.mandateId}`,
          type:      'EE_COMPLIANCE',
          severity:  'WARNING',
          message:   `EE target not met for mandate ${m.title} at ${m.client}.`,
          mandateId: m.mandateId,
        });
      });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'MANCO dashboard retrieved.',
      data: {
        alerts,
        recruiters,
        sortedBy,
        summary: {
          totalActiveMandates:       DB.mandates.filter(m => m.status === 'ACTIVE').length,
          totalCandidatesInPipeline: DB.applications.length,
          placementsThisQuarter:     DB.recruiters.reduce((acc, r) => acc + (r.metrics?.placements ?? 0), 0),
          revenueYTD:                DB.recruiters.reduce((acc, r) => acc + (r.metrics?.revenueYTD ?? 0), 0),
          avgTimeToPlace:            22,
        },
      },
    });
  });

  return router;
}

// ─── Recruiter performance (separate mount path) ──────────────────────────────
export function mancoRecruiterPerformanceRouter({ DB }) {
  const router = Router();

  // GET /api/manco/recruiters/:id/performance
  router.get('/:id/performance', (req, res) => {
    const { id } = req.params;
    const rec = DB.recruiters.find(r => r.recruiterId === id);
    if (!rec)
      return res.status(404).json({ success: false, statusCode: 404, message: `Recruiter ${id} not found.` });

    const jobs    = DB.jobs.filter(j => j.recruiterId === id);
    const mandate = DB.mandates.filter(m => m.recruiterId === id);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Recruiter performance retrieved.',
      data: {
        recruiterId:    id,
        name:           rec.fullName,
        email:          rec.email,
        specialisation: rec.specialisation ?? [],
        metrics: {
          placements:     rec.metrics?.placements ?? 0,
          activeRoles:    mandate.filter(m => m.status === 'ACTIVE').length,
          candidates:     rec.metrics?.candidates ?? 0,
          conversionRate: rec.metrics?.conversionRate ?? 0,
          avgDaysToPlace: rec.metrics?.avgDaysToPlace ?? 0,
          revenueYTD:     rec.metrics?.revenueYTD ?? 0,
        },
        kpiTrend: [
          { month: 'Aug', placements: Math.max(0, (rec.metrics?.placements ?? 4) - 3), revenue: (Math.max(0, (rec.metrics?.placements ?? 4) - 3)) * 48000 },
          { month: 'Sep', placements: Math.max(0, (rec.metrics?.placements ?? 4) - 2), revenue: (Math.max(0, (rec.metrics?.placements ?? 4) - 2)) * 48000 },
          { month: 'Oct', placements: Math.max(0, (rec.metrics?.placements ?? 4) - 1), revenue: (Math.max(0, (rec.metrics?.placements ?? 4) - 1)) * 48000 },
          { month: 'Nov', placements: rec.metrics?.placements ?? 0,                     revenue: (rec.metrics?.placements ?? 0) * 48000                     },
        ],
        jobsManaged: jobs.length,
        activeMandates: mandate.filter(m => m.status === 'ACTIVE').length,
        closedMandates: mandate.filter(m => m.status !== 'ACTIVE').length,
      },
    });
  });

  return router;
}
