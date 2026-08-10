/**
 * AUTH ROUTES  (v2 contract)
 *
 * POST /auth/register          → register a new user account
 * POST /auth/login             → login, return JWT access/refresh tokens
 * POST /auth/forgot-password   → send reset link (mock)
 * POST /auth/change-password   → change password (mock)
 * POST /auth/logout            → invalidate token
 * GET  /auth/me                → current authenticated user (alias for GET /api/v1/users/me)
 */

import { Router } from 'express';

export function authRouter({ USERS, sessions, generateToken, DB }) {
  const router = Router();

  // POST /auth/register
  router.post('/register', (req, res) => {
    const {
      userType,
      firstName,
      lastName,
      email,
      mobileNumber,
      password,
      confirmPassword,
      acceptTerms,
      acceptPrivacyPolicy,
    } = req.body ?? {};

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Required fields missing.' });

    if (password !== confirmPassword)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Passwords do not match.' });

    const exists = DB.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (exists)
      return res.status(409).json({ success: false, statusCode: 409, message: 'Email already registered.' });

    const userId = `USR${String(100000 + DB.users.length + 1)}`;
    const newUser = {
      userId,
      userType: userType ?? 'JOB_SEEKER',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase(),
      mobileNumber: mobileNumber ?? '',
      password,
      accountStatus: 'PENDING_VERIFICATION',
      profileCompleted: 10,
      roles: [userType ?? 'JOB_SEEKER'],
      acceptTerms: acceptTerms ?? false,
      acceptPrivacyPolicy: acceptPrivacyPolicy ?? false,
      createdAt: new Date().toISOString(),
    };
    DB.users.push(newUser);

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Registration completed successfully.',
      data: {
        userId,
        email: newUser.email,
        accountStatus: 'PENDING_VERIFICATION',
      },
    });
  });

  // POST /auth/login
  router.post('/login', (req, res) => {
    const { username, password, rememberMe } = req.body ?? {};
    if (!username || !password)
      return res.status(400).json({ success: false, statusCode: 400, message: 'username and password are required.' });

    // Look up in USERS seed first, then DB.users
    let userRecord = USERS[username.toLowerCase()] ?? null;

    if (!userRecord) {
      const dbUser = DB.users.find(
        u => u.email?.toLowerCase() === username.toLowerCase() && u.password === password
      );
      if (dbUser) {
        userRecord = {
          sub: dbUser.userId,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          roles: dbUser.roles ?? ['JOB_SEEKER'],
          userId: dbUser.userId,
          recruiterId: dbUser.recruiterId ?? null,
          profileCompleted: dbUser.profileCompleted ?? 0,
        };
      }
    } else if (password !== 'Password123') {
      userRecord = null;
    }

    if (!userRecord)
      return res.status(401).json({ success: false, statusCode: 401, message: 'Invalid username or password.' });

    const accessToken = generateToken(userRecord);
    const refreshToken = generateToken({ ...userRecord, type: 'refresh' });
    sessions.set(accessToken, userRecord);

    const expiresIn = rememberMe ? 86400 : 3600;

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        expiresIn,
        profileCompleted: userRecord.profileCompleted ?? 82,
        roles: userRecord.roles ?? ['JOB_SEEKER'],
      },
    });
  });

  // POST /auth/forgot-password
  router.post('/forgot-password', (req, res) => {
    const { email } = req.body ?? {};
    if (!email)
      return res.status(400).json({ success: false, statusCode: 400, message: 'email is required.' });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'If the email address is registered, a password reset link has been sent.',
      data: {
        email: email.toLowerCase(),
        resetLinkSent: true,
        expiresInMinutes: 30,
      },
    });
  });

  // POST /auth/change-password
  router.post('/change-password', (req, res) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body ?? {};

    if (!currentPassword || !newPassword || !confirmNewPassword)
      return res.status(400).json({ success: false, statusCode: 400, message: 'All password fields are required.' });

    if (newPassword !== confirmNewPassword)
      return res.status(400).json({ success: false, statusCode: 400, message: 'New passwords do not match.' });

    if (newPassword.length < 8)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Password must be at least 8 characters.' });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Password changed successfully.',
      data: { changedAt: new Date().toISOString() },
    });
  });

  // POST /auth/logout
  router.post('/logout', (req, res) => {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && sessions.has(token)) {
      sessions.delete(token);
    }
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Logged out successfully.',
      data: null,
    });
  });

  // GET /auth/me  — current authenticated user
  router.get('/me', (req, res) => {
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    const session = token ? sessions.get(token) : null;

    if (!session)
      return res.status(401).json({ success: false, statusCode: 401, message: 'Not authenticated. Please login first.' });

    const user = DB.users.find(u => u.userId === (session.userId ?? session.sub));
    if (!user)
      return res.status(404).json({ success: false, statusCode: 404, message: 'User not found.' });

    const staffProfile = user.staffNumber
      ? { staffNumber: user.staffNumber, departmentCode: user.departmentCode ?? '' }
      : null;

    return res.status(200).json({
      userId:        user.userId,
      email:         user.email,
      provider:      user.provider ?? 'LOCAL',
      roles:         user.roles ?? [],
      staffProfile,
      accountStatus: user.accountStatus ?? 'ACTIVE',
    });
  });

  return router;
}
