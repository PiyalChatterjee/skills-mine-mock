/**
 * PIPELINE ROUTES  (v2 contract)
 *
 * PATCH /api/v1/pipeline/:pipelineId/stage   → advance candidate through pipeline
 *
 * Supported transitions:
 *   Inbound      → Screening
 *   Screening    → Assessment
 *   Assessment   → Interview
 *   Interview    → Shortlist
 *
 * Each transition validates a checklist payload.
 */

import { Router } from 'express';

const VALID_TRANSITIONS = {
  Inbound:    { to: 'Screening',  requiredChecklist: ['cvReceived'] },
  Screening:  { to: 'Assessment', requiredChecklist: ['screeningNotesAdded', 'cvVerified'] },
  Assessment: { to: 'Interview',  requiredChecklist: ['assessmentScoreRecorded', 'assessmentPassed'] },
  Interview:  { to: 'Shortlisted', requiredChecklist: ['interviewNotesAdded', 'interviewCompleted'] },
};

export function pipelineRouter({ DB }) {
  const router = Router();

  // PATCH /api/v1/pipeline/:pipelineId/stage
  router.patch('/:pipelineId/stage', (req, res) => {
    const { pipelineId } = req.params;
    const { targetStage, checklist } = req.body ?? {};

    if (!targetStage)
      return res.status(400).json({ success: false, statusCode: 400, message: 'targetStage is required.' });

    // pipelineId maps to applicationId in this mock
    const app = DB.applications.find(a => a.applicationId === pipelineId);
    if (!app)
      return res.status(404).json({ success: false, statusCode: 404, message: `Pipeline entry ${pipelineId} not found.` });

    const currentStage = app.currentStage;
    const transition   = VALID_TRANSITIONS[currentStage];

    if (!transition)
      return res.status(422).json({
        success: false,
        statusCode: 422,
        message: `Stage '${currentStage}' cannot be advanced further via this endpoint.`,
      });

    if (transition.to !== targetStage)
      return res.status(422).json({
        success: false,
        statusCode: 422,
        message: `Invalid transition: '${currentStage}' can only advance to '${transition.to}', not '${targetStage}'.`,
        allowedTransition: { from: currentStage, to: transition.to },
      });

    // Validate checklist
    const missing = transition.requiredChecklist.filter(item => !(checklist ?? {})[item]);
    if (missing.length > 0)
      return res.status(422).json({
        success: false,
        statusCode: 422,
        message: 'Required checklist items are incomplete.',
        missingItems: missing,
      });

    const previousStage = app.currentStage;
    app.currentStage    = targetStage;
    app.updatedAt       = new Date().toISOString();

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: `Candidate advanced from ${previousStage} to ${targetStage}.`,
      data: {
        pipelineId,
        applicationId:  pipelineId,
        candidateId:    app.candidateId,
        jobId:          app.jobId,
        previousStage,
        currentStage:   targetStage,
        checklistItems: checklist,
        updatedAt:      app.updatedAt,
        nextTransition: VALID_TRANSITIONS[targetStage] ?? null,
      },
    });
  });

  return router;
}
