/**
 * SKILLS ROUTES  (v2 contract)
 *
 * GET /skills/search   → search skills by keyword
 *   ?keyword=          full-text search on skill name or category
 *   ?limit=            max results (default 20)
 */

import { Router } from 'express';

export function skillsRouter({ DB }) {
  const router = Router();

  // GET /skills/search
  router.get('/search', (req, res) => {
    const { keyword, limit = '20' } = req.query;
    const pageSize = Math.min(parseInt(limit, 10) || 20, 100);

    let results = [...DB.skills];

    if (keyword) {
      const lc = keyword.toLowerCase();
      results = results.filter(
        s =>
          s.name?.toLowerCase().includes(lc) ||
          s.category?.toLowerCase().includes(lc)
      );
    }

    const data = results.slice(0, pageSize);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Skills retrieved successfully.',
      data: {
        skills: data,
        total: results.length,
        shown: data.length,
      },
    });
  });

  return router;
}
