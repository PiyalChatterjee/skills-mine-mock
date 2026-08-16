/**
 * USERS ROUTES  (v2 contract)
 *
 * GET    /users/:userId              → full user profile (includes savedJobs)
 * PUT    /users/:userId              → update user profile
 * POST   /users/:userId/profile-photo → upload profile photo (mock)
 * DELETE /users/:userId/profile-photo → remove profile photo
 */

import { Router } from 'express';

export function usersRouter({ DB }) {
  const router = Router();

  // GET /users/:userId
  router.get('/:userId', (req, res) => {
    const { userId } = req.params;
    const user = DB.users.find(u => u.userId === userId);
    if (!user) return res.status(404).json({ success: false, statusCode: 404, message: `User ${userId} not found.` });

    // Find associated candidate profile
    const profile = DB.candidateProfiles.find(p => p.userId === userId);

    return res.status(200).json({
      status: 'SUCCESS',
      data: {
        userId: user.userId,
        savedJobs: user.savedJobs ?? [],
        recommendedJobs: user.recommendedJobs ?? [],
        personalDetails: profile
          ? {
              userId: user.userId,
              firstName: profile.personalDetails.firstName,
              lastName: profile.personalDetails.lastName,
              email: profile.personalDetails.email,
              mobileNumber: profile.personalDetails.mobileNumber,
              location: profile.personalDetails.location,
              nationality: profile.personalDetails.nationality,
              idNumber: profile.personalDetails.idNumber,
              eeStatus: profile.personalDetails.eeStatus,
              profileImageUrl: profile.personalDetails.profileImageUrl,
              thumbnailUrl: profile.personalDetails.thumbnailUrl,
              linkedinUrl: profile.personalDetails.linkedinUrl,
              portfolioUrl: profile.personalDetails.portfolioUrl,
            }
          : {
              userId: user.userId,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              mobileNumber: user.mobileNumber ?? '',
              location: '',
              nationality: '',
              idNumber: '',
              eeStatus: '',
              profileImageUrl: '',
              thumbnailUrl: '',
              linkedinUrl: '',
              portfolioUrl: '',
            },
        desiredJob: profile?.desiredJob ?? {},
        education: profile?.education ?? [],
        experience: profile?.experience ?? [],
        authentication: {
          password: user.password ?? '',
          provider: user.provider ?? 'LOCAL',
          accountStatus: user.accountStatus ?? 'ACTIVE',
        },
      },
    });
  });

  // PUT /users/:userId
  router.put('/:userId', (req, res) => {
    const { userId } = req.params;
    const userIdx = DB.users.findIndex(u => u.userId === userId);
    if (userIdx === -1)
      return res.status(404).json({ success: false, statusCode: 404, message: `User ${userId} not found.` });

    const profileIdx = DB.candidateProfiles.findIndex(p => p.userId === userId);
    const updates = req.body ?? {};

    // Update base user fields (savedJobs is mutable via PUT but not overwritten unless explicitly sent)
    const IMMUTABLE = ['userId', 'userType', 'createdAt', 'roles'];
    const userUpdates = { ...updates };
    IMMUTABLE.forEach(k => delete userUpdates[k]);

    if (Object.keys(userUpdates).length > 0) {
      DB.users[userIdx] = { ...DB.users[userIdx], ...userUpdates };
    }

    // Update or create candidate profile
    if (profileIdx !== -1) {
      if (updates.personalDetails)
        DB.candidateProfiles[profileIdx].personalDetails = { ...DB.candidateProfiles[profileIdx].personalDetails, ...updates.personalDetails };
      if (updates.desiredJob)
        DB.candidateProfiles[profileIdx].desiredJob = { ...DB.candidateProfiles[profileIdx].desiredJob, ...updates.desiredJob };
      if (updates.education)
        DB.candidateProfiles[profileIdx].education = updates.education;
      if (updates.experience)
        DB.candidateProfiles[profileIdx].experience = updates.experience;
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Profile updated successfully.',
      data: {
        userId,
        updatedAt: new Date().toISOString(),
      },
    });
  });

  // POST /users/:userId/profile-photo
  router.post('/:userId/profile-photo', (req, res) => {
    const { userId } = req.params;
    const user = DB.users.find(u => u.userId === userId);
    if (!user)
      return res.status(404).json({ success: false, statusCode: 404, message: `User ${userId} not found.` });

    const profileImageUrl = `https://mock-cdn.skillsmine.com/profiles/${userId}/photo.jpg`;
    const thumbnailUrl = `https://mock-cdn.skillsmine.com/profiles/${userId}/thumb.jpg`;

    // Update candidate profile if exists
    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    if (profile) {
      profile.personalDetails.profileImageUrl = profileImageUrl;
      profile.personalDetails.thumbnailUrl = thumbnailUrl;
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Profile photo uploaded successfully.',
      data: { profileImageUrl, thumbnailUrl },
    });
  });

  // DELETE /users/:userId/profile-photo
  router.delete('/:userId/profile-photo', (req, res) => {
    const { userId } = req.params;
    const user = DB.users.find(u => u.userId === userId);
    if (!user)
      return res.status(404).json({ success: false, statusCode: 404, message: `User ${userId} not found.` });

    const profile = DB.candidateProfiles.find(p => p.userId === userId);
    if (profile) {
      profile.personalDetails.profileImageUrl = '';
      profile.personalDetails.thumbnailUrl = '';
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Profile photo removed successfully.',
      data: null,
    });
  });

  return router;
}
