/**
 * AUTH ROUTES
 *
 * POST /auth/login   → validate credentials, return JWT + dashboardUrl
 * GET  /auth/me      → return current user from session
 * POST /auth/logout  → invalidate token
 */

import { Router } from 'express';

export function authRouter({ USERS, PASSWORDS, sessions, generateToken, ROLE_DASHBOARD }) {
  const router = Router();

  // POST /auth/login
  router.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required.' });

    const user = USERS[email?.toLowerCase()];
    if (!user || !PASSWORDS[password])
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = generateToken(user);
    sessions.set(token, user);
    console.log(`[AUTH] Login : ${user.email} (${user.role})`);

    const { sub, iat, exp, ...safeUser } = user;
    return res.status(200).json({
      userId:       user.sub,
      role:         user.role,
      token,
      dashboardUrl: ROLE_DASHBOARD[user.role] ?? '/',
      user:         { id: user.sub, ...safeUser },
      expiresIn:    86400,
    });
  });

  // GET /auth/me
  router.get('/me', (req, res) => {
    const user = req.currentUser;
    if (!user) return res.status(401).json({ error: 'Not authenticated.' });
    const { sub, iat, exp, ...safeUser } = user;
    return res.status(200).json({ user: { id: user.sub, ...safeUser } });
  });

  // POST /auth/logout
  router.post('/logout', (req, res) => {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && sessions.has(token)) {
      const user = sessions.get(token);
      sessions.delete(token);
      console.log(`[AUTH] Logout: ${user.email}`);
    }
    return res.status(200).json({ message: 'Logged out successfully.' });
  });

  return router;
}
