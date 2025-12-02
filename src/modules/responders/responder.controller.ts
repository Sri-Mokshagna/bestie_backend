import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { responderService } from './responder.service';
import { AppError } from '../../middleware/errorHandler';

export const responderController = {
  async getResponders(req: AuthRequest, res: Response) {
    const onlineOnly = req.query.onlineOnly === 'true';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const userLanguage = req.user?.profile?.language;

    const responders = await responderService.getResponders(
      onlineOnly,
      page,
      limit,
      userLanguage
    );

    res.json({ responders });
  },

  async getResponderById(req: AuthRequest, res: Response) {
    const { responderId } = req.params;

    const responder = await responderService.getResponderById(responderId);

    res.json({ responder });
  },

  async toggleOnlineStatus(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { isOnline } = req.body;

    if (typeof isOnline !== 'boolean') {
      throw new AppError(400, 'isOnline must be a boolean');
    }

    const responder = await responderService.toggleOnlineStatus(
      req.user.id,
      isOnline
    );

    res.json({ responder });
  },

  async updateAvailabilityStatus(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { isOnline, audioEnabled, videoEnabled, chatEnabled } = req.body;

    if (isOnline !== undefined && typeof isOnline !== 'boolean') {
      throw new AppError(400, 'isOnline must be a boolean');
    }

    if (audioEnabled !== undefined && typeof audioEnabled !== 'boolean') {
      throw new AppError(400, 'audioEnabled must be a boolean');
    }

    if (videoEnabled !== undefined && typeof videoEnabled !== 'boolean') {
      throw new AppError(400, 'videoEnabled must be a boolean');
    }

    if (chatEnabled !== undefined && typeof chatEnabled !== 'boolean') {
      throw new AppError(400, 'chatEnabled must be a boolean');
    }

    const updates: {
      isOnline?: boolean;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      chatEnabled?: boolean;
    } = {};

    if (isOnline !== undefined) updates.isOnline = isOnline;
    if (audioEnabled !== undefined) updates.audioEnabled = audioEnabled;
    if (videoEnabled !== undefined) updates.videoEnabled = videoEnabled;
    if (chatEnabled !== undefined) updates.chatEnabled = chatEnabled;

    const status = await responderService.updateAvailabilityStatus(req.user.id, updates);

    res.json({ status });
  },

  async getAvailabilityStatus(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const status = await responderService.getAvailabilityStatus(req.user.id);

    res.json({ status });
  },

  async applyAsResponder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { name, gender, bio, idProofUrl, voiceProofUrl } = req.body;

    // Only name, gender, bio, and voiceProofUrl are required. idProofUrl (aadhar) is optional
    if (!name || !gender || !bio || !voiceProofUrl) {
      throw new AppError(400, 'Name, gender, bio, and voice recording are required');
    }

    const responder = await responderService.applyAsResponder(req.user.id, {
      name,
      gender,
      bio,
      idProofUrl, // Optional
      voiceProofUrl,
    });

    res.json({ responder });
  },

  async getPendingApplications(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    if (req.user.role !== 'admin') {
      throw new AppError(403, 'Admin access required');
    }

    const applications = await responderService.getPendingApplications();

    res.json({ applications });
  },

  async approveResponder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    if (req.user.role !== 'admin') {
      throw new AppError(403, 'Admin access required');
    }

    const { responderId } = req.params;

    const responder = await responderService.approveResponder(
      responderId,
      req.user.id
    );

    res.json({ responder, message: 'Responder approved successfully' });
  },

  async rejectResponder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    if (req.user.role !== 'admin') {
      throw new AppError(403, 'Admin access required');
    }

    const { responderId } = req.params;
    const { reason } = req.body;

    const responder = await responderService.rejectResponder(
      responderId,
      req.user.id,
      reason
    );

    res.json({ responder, message: 'Responder rejected' });
  },
};
