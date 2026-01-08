import { Request, Response } from 'express';
import { responderService } from './responder.service';
import { AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';

export const responderController = {
  async getResponders(req: Request, res: Response) {
    const { onlineOnly } = req.query;

    const responders = await responderService.getActiveResponders(
      onlineOnly === 'true'
    );

    res.json({ responders });
  },

  async getResponderById(req: Request, res: Response) {
    const { id } = req.params;

    const responder = await responderService.getResponderById(id);

    res.json({ responder });
  },

  async updateStatus(req: AuthRequest, res: Response) {
    const { isOnline, isAvailable } = req.body;

    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (typeof isOnline !== 'boolean') {
      res.status(400).json({ error: 'isOnline must be a boolean' });
      return;
    }

    const result = await responderService.updateResponderStatus(
      req.user.id,
      isOnline,
      isAvailable
    );

    res.json(result);
  },

  async updateAvailability(req: AuthRequest, res: Response) {
    const { audioEnabled, videoEnabled, chatEnabled } = req.body;

    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (typeof audioEnabled !== 'boolean' || typeof videoEnabled !== 'boolean' || typeof chatEnabled !== 'boolean') {
      res.status(400).json({ error: 'audioEnabled, videoEnabled, and chatEnabled must be booleans' });
      return;
    }

    const result = await responderService.updateAvailability(
      req.user.id,
      audioEnabled,
      videoEnabled,
      chatEnabled
    );

    res.json(result);
  },

  async getMyProfile(req: AuthRequest, res: Response) {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const profile = await responderService.getMyProfile(req.user.id);

    res.json(profile);
  },

  async disableAllAvailability(req: AuthRequest, res: Response) {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const result = await responderService.disableAllAvailability(req.user.id);

    res.json(result);
  },

  // ===== Application & Admin Methods =====
  
  async applyAsResponder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { name, gender, bio, idProofUrl, voiceProofUrl } = req.body;

    if (!name || !gender || !bio || !voiceProofUrl) {
      throw new AppError(400, 'Name, gender, bio, and voice recording are required');
    }

    const responder = await responderService.applyAsResponder(req.user.id, {
      name,
      gender,
      bio,
      idProofUrl,
      voiceProofUrl,
    });

    res.json({ responder });
  },

  async getPendingApplications(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const applications = await responderService.getPendingApplications();

    res.json({ applications });
  },

  async approveResponder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
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
