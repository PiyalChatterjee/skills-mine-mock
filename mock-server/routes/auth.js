/**
 * AUTH ROUTES
 *
 * POST /auth/login   → validate credentials, return JWT + dashboardUrl
 * POST /auth/signup  → candidate signup, return JWT + user
 * GET  /auth/me      → return current user from session
 * POST /auth/logout  → invalidate token
 */

import { Router } from 'express';

export function authRouter({ USERS, PASSWORDS, sessions, generateToken, ROLE_DASHBOARD, DB, saveDataset }) {
  const router = Router();

  // POST /auth/signup
  router.post('/signup', (req, res) => {
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
      confirmPassword,
      passwordHint,
      termsAccepted,
    } = req.body ?? {};

    const fieldErrors = {};

    if (!firstName?.trim()) fieldErrors.firstName = 'First name is required';
    if (!lastName?.trim()) fieldErrors.lastName = 'Last name is required';
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = 'Invalid email format';
    if (!phoneNumber?.trim()) fieldErrors.phoneNumber = 'Phone number is required';
    if (!password || password.length < 8) fieldErrors.password = 'Password must be at least 8 characters';
    if (!confirmPassword || confirmPassword !== password) fieldErrors.confirmPassword = 'Passwords do not match';
    if (!passwordHint?.trim()) fieldErrors.passwordHint = 'Password hint is required';
    if (termsAccepted !== true) fieldErrors.termsAccepted = 'You must accept the terms and privacy policy';

    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({
        message: 'Invalid signup payload',
        code: 'VALIDATION_ERROR',
        fieldErrors,
      });
    }

    if (email.toLowerCase() === 'existing@skillsmine.com') {
      return res.status(409).json({
        message: 'Email already registered',
        code: 'EMAIL_EXISTS',
      });
    }

    const candidateId = `candidate-${String(DB.candidates.length + 1001)}`;
    const user = {
      sub: candidateId,
      email: email.toLowerCase(),
      role: 'candidate',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      candidateId,
      permissions: ['VIEW_JOBS', 'APPLY_JOB', 'UPLOAD_CV', 'VIEW_DASHBOARD'],
    };

    DB.candidates.push({
      candidateId,
      fullName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      phone: phoneNumber,
      password,
      role: 'candidate',
      registeredAt: new Date().toISOString(),
      profileComplete: 15,
    });
    saveDataset('candidates', DB.candidates);

    const token = generateToken(user);
    sessions.set(token, user);

    return res.status(201).json({
      token,
      expiresIn: 3600,
      user: {
        id: user.sub,
        email: user.email,
        displayName: `${user.firstName} ${user.lastName}`,
        role: user.role,
        permissions: user.permissions,
      },
    });
  });

  // POST /auth/login
  router.post('/login', (req, res) => {
    const { email, candidateId, password } = req.body ?? {};
    const loginId = email ?? candidateId;
    if (!loginId || !password)
      return res.status(400).json({ error: 'email or candidateId and password are required.' });

    let user = email ? USERS[email.toLowerCase()] : null;

    if (!user) {
      const candidate = DB.candidates.find(c =>
        ((email && c.email?.toLowerCase() === email.toLowerCase()) || (candidateId && c.candidateId === candidateId)) &&
        c.password === password
      );
      if (candidate) {
        const [firstName, ...rest] = (candidate.fullName ?? '').split(' ');
        user = {
          sub: candidate.candidateId,
          email: candidate.email,
          role: 'candidate',
          firstName: firstName ?? '',
          lastName: rest.join(' '),
          candidateId: candidate.candidateId,
          permissions: ['VIEW_JOBS', 'APPLY_JOB', 'UPLOAD_CV', 'VIEW_DASHBOARD'],
        };
      }
    }

    if (!user || (email && USERS[email.toLowerCase()] && !PASSWORDS[password]))
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
