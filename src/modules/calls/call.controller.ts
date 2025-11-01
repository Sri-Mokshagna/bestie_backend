import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { callService } from './call.service';
import { AppError } from '../../middleware/errorHandler';
import { CallType } from '../../models/Call';

export const callController = {
  async initiateCall(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { responderId, type } = req.body;

    if (!responderId || !type) {
      throw new AppError(400, 'Missing required fields');
    }

    if (!Object.values(CallType).includes(type)) {
      throw new AppError(400, 'Invalid call type');
    }

    const call = await callService.initiateCall(
      req.user.id,
      responderId,
      type as CallType
    );

    res.json({ call });
  },

  async acceptCall(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;

    const call = await callService.acceptCall(callId, req.user.id);

    res.json({ call });
  },

  async rejectCall(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;

    const call = await callService.rejectCall(callId, req.user.id);

    res.json({ call });
  },

  async endCall(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;

    const call = await callService.endCall(callId, req.user.id);

    res.json({ call });
  },

  async getCallStatus(req: AuthRequest, res: Response) {
    const { callId } = req.params;

    const call = await callService.getCallStatus(callId);

    res.json({ call });
  },

  async getCallLogs(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { partnerId } = req.params;

    const calls = await callService.getCallLogs(req.user.id, partnerId);

    res.json({ calls });
  },

  async updateCallDuration(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;
    const { durationSeconds } = req.body;

    if (typeof durationSeconds !== 'number' || durationSeconds < 0) {
      throw new AppError(400, 'Invalid duration');
    }

    const call = await callService.updateCallDuration(callId, durationSeconds);

    res.json({ call });
  },
};
