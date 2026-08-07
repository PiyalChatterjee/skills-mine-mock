/**
 * SKILLS ROUTES  (v2 contract)
 *
 * GET /skills/search   → search skills by keyword; annotates each skill with user selection
 *   ?keyword=          full-text search on skill name or category
 *   ?limit=            max results (default 20)
 *   ?userId=           when provided, marks skills already selected by that user
 *                      (falls back to the authenticated user when omitted)
 */

import { Router } from 'express';

export function skillsRouter({ DB }) {
  const router = Router();

  // GET /skills/search
  router.get('/search', (req, res) => {
    const { keyword, limit = '20', userId } = req.query;
    const pageSize = Math.min(parseInt(limit, 10) || 20, 100);

    // Resolve which user's selection to annotate against.
    // Priority: explicit ?userId param → authenticated user → no annotation
    const resolvedUserId = userId ?? req.currentUser?.userId ?? null;

    // Collect the set of skillIds this user has already selected
    const userSkillRecord = resolvedUserId
      ? DB.userSkills.find(us => us.userId === resolvedUserId)
      : null;
    const selectedSet = new Set(userSkillRecord?.selectedSkills ?? []);

    let results = [...DB.skills];

    if (keyword) {
      const lc = keyword.toLowerCase();
      results = results.filter(
        s =>
          s.name?.toLowerCase().includes(lc) ||
          s.category?.toLowerCase().includes(lc)
      );
    }

    const sliced = results.slice(0, pageSize);

    // Annotate each skill with selection state
    const skills = sliced.map(s => ({
      skillId:   s.skillId,
      skillName: s.name,         // contract field name
      name:      s.name,         // keep original for existing consumers
      category:  s.category,
      selected:  selectedSet.has(s.skillId),
      userId:    resolvedUserId ?? null,
    }));

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Skills retrieved successfully.',
      data: {
        skills,
        userId:    resolvedUserId ?? null,
        total:     results.length,
        shown:     skills.length,
      },
    });
  });

  return router;
}
