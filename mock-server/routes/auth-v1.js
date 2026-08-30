/**
 * AUTH ROUTES  — v1 contract  (auth_service_v0.yaml)
 *
 * Mounted at /api/v1/auth and /api/v1/admin.
 *
 * POST /api/v1/auth/login
 * POST /api/v1/auth/candidates/register
 * POST /api/v1/auth/staff/register
 * POST /api/v1/auth/staff-invitations/validate
 * POST /api/v1/auth/forgot-password
 * POST /api/v1/auth/reset-password
 * POST /api/v1/auth/logout                       → 204 NO CONTENT
 *
 * POST /api/v1/admin/staff-invitations           → create invitation token
 *
 * GET  /api/v1/users/me                          → authenticated user profile
 */

import { Router } from 'express';
import crypto     from 'node:crypto';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Mask an email: j***@domain.com */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

/** Mask a staff number: SM****01 */
function maskStaffNumber(sn) {
  if (!sn || sn.length < 4) return sn;
  const prefix = sn.slice(0, 2);
  const suffix = sn.slice(-2);
  return `${prefix}****${suffix}`;
}

/** Generate a mock JWT-like token with a custom payload */
function buildToken(payload, generateToken) {
  return generateToken(payload);
}

/** Build full three-token response (accessToken, idToken, refreshToken) */
function buildTokenResponse(user, generateToken, expiresIn = 3600) {
  const base = {
    sub:        user.userId ?? user.sub,
    userId:     user.userId ?? user.sub,
    email:      user.email,
    roles:      user.roles,
    provider:   user.provider ?? 'LOCAL',
  };

  const accessToken  = buildToken({ ...base, tokenUse: 'access'  }, generateToken);
  const idToken      = buildToken({ ...base, tokenUse: 'id',
    firstName: user.firstName, lastName: user.lastName,
    staffNumber: user.staffNumber ?? undefined,
    accountStatus: user.accountStatus ?? 'ACTIVE',
  }, generateToken);
  const refreshToken = buildToken({ ...base, tokenUse: 'refresh' }, generateToken);

  return { accessToken, idToken, refreshToken, expiresIn, tokenType: 'Bearer' };
}

// ─── router factories ────────────────────────────────────────────────────────

/**
 * Auth router — mounted at /api/v1/auth
 */
export function authV1Router({ DB, sessions, generateToken, staffInvitations }) {
  const router = Router();

  // ── POST /login ────────────────────────────────────────────────────────────
  router.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};

    if (!email || !password)
      return res.status(400).json({ success: false, statusCode: 400, message: 'email and password are required.' });

    const user = DB.users.find(
      u => u.email?.toLowerCase() === email.toLowerCase() && u.password === password
    );

    if (!user)
      return res.status(401).json({ success: false, statusCode: 401, message: 'Invalid email or password.' });

    if (user.accountStatus === 'INACTIVE' || user.accountStatus === 'SUSPENDED')
      return res.status(403).json({ success: false, statusCode: 403, message: 'Account is not active.' });

    const tokens = buildTokenResponse(user, generateToken, 3600);
    sessions.set(tokens.accessToken, user);

    return res.status(200).json(tokens);
  });

  // ── POST /candidates/register ──────────────────────────────────────────────
  router.post('/candidates/register', (req, res) => {
    const { firstName, lastName, email, mobileNumber, password } = req.body ?? {};

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Required fields missing.' });

    const exists = DB.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (exists)
      return res.status(409).json({ success: false, statusCode: 409, message: 'Email already registered.' });

    const userId = crypto.randomUUID();
    const newUser = {
      userId,
      userType: 'JOB_SEEKER',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase(),
      mobileNumber: mobileNumber ?? '',
      password,
      provider: 'LOCAL',
      accountStatus: 'ACTIVE',
      profileCompleted: 10,
      roles: ['JOB_SEEKER'],
      acceptTerms: false,
      acceptPrivacyPolicy: false,
      createdAt: new Date().toISOString(),
    };
    DB.users.push(newUser);

    return res.status(201).json({
      userId,
      email: newUser.email,
      role: 'JOB_SEEKER',
      registrationType: 'SELF_SERVICE',
      accountStatus: 'ACTIVE',
    });
  });

  // ── POST /recruiters/register ─────────────────────────────────────────────
  // Self-service recruiter sign-up (no invitation token required).
  router.post('/recruiters/register', (req, res) => {
    const { firstName, lastName, email, mobileNumber, password } = req.body ?? {};

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Required fields missing.' });

    const exists = DB.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (exists)
      return res.status(409).json({ success: false, statusCode: 409, message: 'Email already registered.' });

    const userId = crypto.randomUUID();
    const recruiterId = `r${Date.now()}`;
    const newUser = {
      userId,
      userType: 'RECRUITER',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase(),
      mobileNumber: mobileNumber ?? '',
      password,
      provider: 'LOCAL',
      accountStatus: 'ACTIVE',
      profileCompleted: 100,
      roles: ['RECRUITER'],
      recruiterId,
      acceptTerms: true,
      acceptPrivacyPolicy: true,
      tourSeen: false,
      createdAt: new Date().toISOString(),
    };
    DB.users.push(newUser);

    return res.status(201).json({
      userId,
      email: newUser.email,
      role: 'RECRUITER',
      registrationType: 'SELF_SERVICE',
      accountStatus: 'ACTIVE',
    });
  });

  // ── POST /staff/register ───────────────────────────────────────────────────
  router.post('/staff/register', (req, res) => {
    const { invitationToken, email, firstName, lastName, password } = req.body ?? {};

    if (!invitationToken || !email || !firstName || !lastName || !password)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Required fields missing.' });

    // Validate the invitation token
    const invitation = staffInvitations.get(invitationToken);
    if (!invitation)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Invalid or expired invitation token.' });

    if (new Date(invitation.expiresAt) < new Date())
      return res.status(400).json({ success: false, statusCode: 400, message: 'Invitation token has expired.' });

    if (invitation.email.toLowerCase() !== email.toLowerCase())
      return res.status(400).json({ success: false, statusCode: 400, message: 'Email does not match invitation.' });

    // staffNumber and departmentCode come from the invitation — no need to supply them in the request
    const { staffNumber, departmentCode } = invitation;

    const exists = DB.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (exists)
      return res.status(409).json({ success: false, statusCode: 409, message: 'Email already registered.' });

    const userId = crypto.randomUUID();
    const newUser = {
      userId,
      userType: invitation.roleCode,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase(),
      staffNumber,
      departmentCode,
      password,
      provider: 'LOCAL',
      accountStatus: 'ACTIVE',
      profileCompleted: 100,
      roles: [invitation.roleCode],
      acceptTerms: false,
      acceptPrivacyPolicy: false,
      tourSeen: false,
      createdAt: new Date().toISOString(),
    };
    DB.users.push(newUser);

    // Invalidate the invitation token after use
    staffInvitations.delete(invitationToken);

    return res.status(201).json({
      userId,
      staffNumber,
      email: newUser.email,
      role: invitation.roleCode,
      accountStatus: 'ACTIVE',
    });
  });

  // ── POST /staff-invitations/validate ──────────────────────────────────────
  router.post('/staff-invitations/validate', (req, res) => {
    const { invitationToken } = req.body ?? {};

    if (!invitationToken)
      return res.status(400).json({ success: false, statusCode: 400, message: 'invitationToken is required.' });

    const invitation = staffInvitations.get(invitationToken);

    if (!invitation || new Date(invitation.expiresAt) < new Date()) {
      return res.status(200).json({
        valid: false,
        staffNumberMasked: '',
        invitedEmailMasked: '',
        roleCode: '',
        expiresAt: '',
      });
    }

    return res.status(200).json({
      valid: true,
      staffNumberMasked: maskStaffNumber(invitation.staffNumber),
      invitedEmailMasked: maskEmail(invitation.email),
      roleCode: invitation.roleCode,
      expiresAt: invitation.expiresAt,
    });
  });

  // ── POST /forgot-password ──────────────────────────────────────────────────
  router.post('/forgot-password', (req, res) => {
    const { email } = req.body ?? {};
    if (!email)
      return res.status(400).json({ success: false, statusCode: 400, message: 'email is required.' });

    // Always 200 to prevent user enumeration
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'If the email address is registered, a password reset link has been sent.',
    });
  });

  // ── POST /reset-password ───────────────────────────────────────────────────
  router.post('/reset-password', (req, res) => {
    const { resetToken, newPassword } = req.body ?? {};

    if (!resetToken || !newPassword)
      return res.status(400).json({ success: false, statusCode: 400, message: 'resetToken and newPassword are required.' });

    if (newPassword.length < 8)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Password must be at least 8 characters.' });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Password has been reset successfully.',
    });
  });

  // ── POST /logout ───────────────────────────────────────────────────────────
  router.post('/logout', (req, res) => {
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    if (token && sessions.has(token)) sessions.delete(token);
    return res.status(204).send();
  });

  return router;
}

/**
 * Admin router — mounted at /api/v1/admin
 */
export function adminV1Router({ sessions, staffInvitations }) {
  const router = Router();

  // ── POST /staff-invitations ────────────────────────────────────────────────
  router.post('/staff-invitations', (req, res) => {
    // Require authentication
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    const caller = token ? sessions.get(token) : null;

    if (!caller)
      return res.status(401).json({ success: false, statusCode: 401, message: 'Not authenticated.' });

    const callerRoles = caller.roles ?? [];
    if (!callerRoles.includes('ADMIN'))
      return res.status(403).json({ success: false, statusCode: 403, message: 'Forbidden. ADMIN role required.' });

    const { email, staffNumber, roleCode, departmentCode } = req.body ?? {};

    if (!email || !staffNumber || !roleCode || !departmentCode)
      return res.status(400).json({ success: false, statusCode: 400, message: 'Required fields missing.' });

    const VALID_ROLES = ['RECRUITER', 'MANCO', 'EXCO', 'ADMIN'];
    if (!VALID_ROLES.includes(roleCode))
      return res.status(400).json({ success: false, statusCode: 400, message: `Invalid roleCode. Must be one of: ${VALID_ROLES.join(', ')}.` });

    const invitationToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72 hours

    staffInvitations.set(invitationToken, { email, staffNumber, roleCode, departmentCode, expiresAt, createdAt: new Date().toISOString() });

    return res.status(201).json({
      invitationToken,
      email,
      staffNumber,
      roleCode,
      expiresAt,
    });
  });

  return router;
}

/**
 * Users /me router — mounted at /api/v1/users
 */
export function usersV1Router({ DB, sessions }) {
  const router = Router();

  // ── GET /me ────────────────────────────────────────────────────────────────
  router.get('/me', (req, res) => {
    const raw   = req.headers['authorization'] ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    const session = token ? sessions.get(token) : null;

    if (!session)
      return res.status(401).json({ success: false, statusCode: 401, message: 'Not authenticated.' });

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
