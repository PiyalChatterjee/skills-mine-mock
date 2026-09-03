import crypto from 'node:crypto';
import { Router } from 'express';

const STAFF_ROLES = ['RECRUITER', 'MANCO', 'EXCO', 'ADMIN'];
const error = (res, statusCode, message) => res.status(statusCode).json({ success: false, statusCode, message });
const isAdmin = (req) => req.currentUser?.roles?.includes('ADMIN');

const buildTokenResponse = (user, generateToken) => {
  const base = { sub: user.userId, userId: user.userId, email: user.email, roles: user.roles, provider: user.provider ?? 'LOCAL' };
  return {
    accessToken: generateToken({ ...base, tokenUse: 'access' }),
    idToken: generateToken({ ...base, tokenUse: 'id', firstName: user.firstName, lastName: user.lastName, candidateId: user.candidateId, staffNumber: user.staffNumber, accountStatus: user.accountStatus }),
    refreshToken: generateToken({ ...base, tokenUse: 'refresh' }),
    expiresIn: 3600,
    tokenType: 'Bearer',
    isFirstLogin: !user.lastLoginAt,
  };
};

const candidateResponse = (user) => ({ userId: user.userId, email: user.email, role: 'JOB_SEEKER', registrationType: 'SELF_SERVICE', accountStatus: user.accountStatus });

const createCandidate = (DB, { firstName, lastName, email, mobileNumber, password, provider = 'LOCAL', visitorId }) => {
  const user = {
    userId: crypto.randomUUID(), candidateId: crypto.randomUUID(), userType: 'JOB_SEEKER',
    firstName: firstName.trim(), lastName: lastName.trim(), email: email.toLowerCase(), mobileNumber,
    password, provider, accountStatus: 'ACTIVE', profileCompleted: 10, roles: ['JOB_SEEKER'], visitorId,
    createdAt: new Date().toISOString(),
  };
  DB.users.push(user);
  return user;
};

const parseGoogleIdentity = (idToken) => {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return { email: payload.email, firstName: payload.given_name, lastName: payload.family_name };
  } catch {
    return {};
  }
};

export function authV3Router({ DB, sessions, generateToken, staffInvitations }) {
  const router = Router();

  router.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return error(res, 400, 'email and password are required.');
    const user = DB.users.find((item) => item.email?.toLowerCase() === email.toLowerCase() && item.password === password);
    if (!user) return error(res, 401, 'Invalid email or password.');
    if (user.accountStatus === 'INACTIVE' || user.accountStatus === 'SUSPENDED') return error(res, 403, 'Account is not active.');
    const tokens = buildTokenResponse(user, generateToken);
    user.lastLoginAt = new Date().toISOString();
    sessions.set(tokens.accessToken, user);
    return res.status(200).json(tokens);
  });

  router.post('/candidates/register', (req, res) => {
    const { firstName, lastName, email, mobileNumber, password, visitorId } = req.body ?? {};
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !mobileNumber?.trim() || !password) return error(res, 400, 'firstName, lastName, email, mobileNumber, and password are required.');
    if (DB.users.some((item) => item.email?.toLowerCase() === email.toLowerCase())) return error(res, 409, 'Email already registered.');
    if (visitorId && !DB.visitorProfiles.some((visitor) => visitor.visitorId === visitorId)) return error(res, 400, 'Visitor not found.');
    return res.status(201).json(candidateResponse(createCandidate(DB, { firstName, lastName, email, mobileNumber, password, visitorId })));
  });

  router.post('/candidates/register/visitor/conversion', (req, res) => {
    const { visitorId, firstName, lastName, email, mobileNumber, password } = req.body ?? {};
    if (!visitorId || !firstName?.trim() || !lastName?.trim() || !email?.trim() || !mobileNumber?.trim() || !password) return error(res, 400, 'visitorId, firstName, lastName, email, mobileNumber, and password are required.');
    const visitor = DB.visitorProfiles.find((item) => item.visitorId === visitorId);
    if (!visitor) return error(res, 404, 'Visitor not found.');
    if (DB.users.some((item) => item.email?.toLowerCase() === email.toLowerCase())) return error(res, 409, 'Email already registered.');
    visitor.convertedAt = new Date().toISOString();
    return res.status(201).json(candidateResponse(createCandidate(DB, { firstName, lastName, email, mobileNumber, password, visitorId })));
  });

  router.post('/candidates/register-google', (req, res) => {
    const { idToken } = req.body ?? {};
    if (!idToken) return error(res, 400, 'idToken is required.');
    const identity = parseGoogleIdentity(idToken);
    const email = typeof identity.email === 'string' ? identity.email : `google-${crypto.createHash('sha256').update(idToken).digest('hex').slice(0, 12)}@example.com`;
    const existingUser = DB.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (existingUser) return res.status(201).json(candidateResponse(existingUser));
    return res.status(201).json(candidateResponse(createCandidate(DB, { firstName: typeof identity.firstName === 'string' ? identity.firstName : 'Google', lastName: typeof identity.lastName === 'string' ? identity.lastName : 'User', email, mobileNumber: '', password: '', provider: 'GOOGLE' })));
  });

  router.post('/staff/register', (req, res) => {
    const { invitationToken, staffNumber, email, firstName, lastName, password } = req.body ?? {};
    if (!invitationToken || !staffNumber || !email || !firstName?.trim() || !lastName?.trim() || !password) return error(res, 400, 'invitationToken, staffNumber, email, firstName, lastName, and password are required.');
    const invitation = staffInvitations.get(invitationToken);
    if (!invitation || new Date(invitation.expiresAt) < new Date()) return error(res, 400, 'Invalid or expired invitation token.');
    if (invitation.staffNumber !== staffNumber || invitation.email.toLowerCase() !== email.toLowerCase()) return error(res, 400, 'Invitation details do not match.');
    const profile = DB.staffProfiles.find((item) => item.staffNumber === staffNumber && item.primaryEmail.toLowerCase() === email.toLowerCase());
    if (!profile) return error(res, 400, 'Staff profile not found.');
    if (DB.users.some((item) => item.email?.toLowerCase() === email.toLowerCase())) return error(res, 409, 'Email already registered.');
    const user = { userId: profile.userId, userType: profile.roleCode, firstName: firstName.trim(), lastName: lastName.trim(), email: email.toLowerCase(), staffNumber, password, provider: 'LOCAL', accountStatus: 'ACTIVE', profileCompleted: 100, roles: [profile.roleCode], createdAt: new Date().toISOString() };
    DB.users.push(user);
    profile.registrationStatus = 'REGISTERED';
    profile.updatedAt = new Date().toISOString();
    staffInvitations.delete(invitationToken);
    return res.status(201).json({ userId: user.userId, staffNumber, email: user.email, role: profile.roleCode, accountStatus: user.accountStatus });
  });

  router.post('/forgot-password', (req, res) => {
    if (!req.body?.email) return error(res, 400, 'email is required.');
    return res.status(200).json({ message: 'If the email address is registered, a password reset link has been sent.' });
  });

  router.post('/reset-password', (req, res) => {
    const { email, confirmationCode, currentPassword, newPassword } = req.body ?? {};
    if (!newPassword) return error(res, 400, 'newPassword is required.');
    if (newPassword.length < 8) return error(res, 400, 'Password must be at least 8 characters.');
    if (!currentPassword && (!email || !confirmationCode)) return error(res, 400, 'Provide currentPassword or both email and confirmationCode.');
    if (currentPassword && req.currentUser && req.currentUser.password !== currentPassword) return error(res, 400, 'Current password is incorrect.');
    const user = req.currentUser ?? DB.users.find((item) => item.email?.toLowerCase() === email?.toLowerCase());
    if (user) user.password = newPassword;
    return res.status(200).json({ message: 'Password has been reset successfully.' });
  });

  router.post('/logout', (req, res) => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    if (token) sessions.delete(token);
    return res.status(204).send();
  });

  return router;
}

export function usersV3Router({ DB, sessions }) {
  const router = Router();
  router.post('/validate', (req, res) => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    return res.status(200).json({ valid: Boolean(token && sessions.has(token)) });
  });
  router.get('/me', (req, res) => {
    const user = DB.users.find((item) => item.userId === req.currentUser?.userId);
    if (!user) return error(res, 404, 'User not found.');
    const staffProfile = user.staffNumber ? { staffNumber: user.staffNumber, firstName: user.firstName, lastName: user.lastName, employmentStatus: 'ACTIVE' } : undefined;
    return res.status(200).json({ userId: user.userId, email: user.email, provider: user.provider ?? 'LOCAL', roles: user.roles ?? [], staffProfile, candidateId: user.candidateId, accountStatus: user.accountStatus });
  });
  return router;
}

export function staffProfilesV3Router({ DB }) {
  const router = Router();
  router.get('/profiles', (req, res) => {
    if (!isAdmin(req)) return error(res, 403, 'ADMIN role required.');
    return res.status(200).json(DB.staffProfiles);
  });
  router.post('/profiles', (req, res) => {
    if (!isAdmin(req)) return error(res, 403, 'ADMIN role required.');
    const { staffNumber, primaryEmail, roleCode, firstName, lastName } = req.body ?? {};
    if (!staffNumber || !primaryEmail || !roleCode || !firstName?.trim() || !lastName?.trim()) return error(res, 400, 'staffNumber, primaryEmail, roleCode, firstName, and lastName are required.');
    if (!STAFF_ROLES.includes(roleCode)) return error(res, 400, 'Invalid roleCode.');
    if (DB.staffProfiles.some((item) => item.staffNumber === staffNumber || item.primaryEmail.toLowerCase() === primaryEmail.toLowerCase())) return error(res, 409, 'A staff profile with this staff number or email already exists.');
    const now = new Date().toISOString();
    const profile = { staffId: crypto.randomUUID(), userId: crypto.randomUUID(), staffNumber, primaryEmail: primaryEmail.toLowerCase(), firstName: firstName.trim(), lastName: lastName.trim(), roleCode, registrationStatus: 'PENDING', employmentStatus: 'ACTIVE', createdAt: now, updatedAt: now };
    DB.staffProfiles.push(profile);
    return res.status(201).json({ userId: profile.userId, staffId: profile.staffId, staffNumber: profile.staffNumber, firstName: profile.firstName, lastName: profile.lastName, roleCode: profile.roleCode, employmentStatus: profile.employmentStatus });
  });
  return router;
}

export function adminV3Router({ DB, staffInvitations }) {
  const router = Router();
  router.post('/staff-invitations/send', (req, res) => {
    if (!isAdmin(req)) return error(res, 403, 'ADMIN role required.');
    const { email, staffNumber } = req.body ?? {};
    if (!email || !staffNumber) return error(res, 400, 'email and staffNumber are required.');
    const profile = DB.staffProfiles.find((item) => item.staffNumber === staffNumber && item.primaryEmail.toLowerCase() === email.toLowerCase());
    if (!profile) return error(res, 404, 'Staff profile not found.');
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    staffInvitations.set(invitationId, { email, staffNumber, expiresAt });
    return res.status(200).json({ invitationId, email, staffNumber, expiresAt, message: 'Staff invitation sent successfully.' });
  });
  return router;
}