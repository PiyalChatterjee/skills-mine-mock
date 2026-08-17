/**
 * INDUSTRIES ROUTES
 *
 * GET /industries   → list all industries
 */

import { Router } from 'express';

export function industriesRouter({ DB }) {
  const router = Router();

  // GET /industries
  router.get('/', (req, res) => {
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Industries retrieved successfully.',
      data: DB.industries,
    });
  });

  return router;
}
