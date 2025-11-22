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

    // Enhanced logging for debugging
    console.log('Call initiate request:', {
      userId: req.user.id,
      body: req.body,
      responderId,
      type,
      typeOf: typeof type,
    });

    if (!responderId || !type) {
      throw new AppError(400, `Missing required fields. Received: responderId=${responderId}, type=${type}`);
    }

    if (!Object.values(CallType).includes(type)) {
      throw new AppError(400, `Invalid call type: ${type}. Expected: ${Object.values(CallType).join(' or ')}`);
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

  async getCallHistory(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const calls = await callService.getCallHistory(req.user.id);

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

  async confirmConnection(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;

    const call = await callService.confirmCallConnection(callId, req.user.id);

    res.json({ call });
  },

  async reportConnectionFailure(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;
    const { reason } = req.body;

    const call = await callService.handleCallConnectionFailure(
      callId, 
      req.user.id, 
      reason || 'Unknown connection error'
    );

    res.json({ call });
  },

  // Get ZEGO token for call
  async getZegoToken(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { callId } = req.params;

    // Verify call exists and user is participant
    const call = await callService.getCallStatus(callId);
    
    if (call.userId.toString() !== req.user.id && 
        call.responderId.toString() !== req.user.id) {
      throw new AppError(403, 'Not authorized');
    }

    const token = callService.generateZegoToken(req.user.id, call.zegoRoomId);
    
    res.json({ 
      token,
      roomId: call.zegoRoomId,
      userId: req.user.id
    });
  },

  // Cleanup endpoint - mark old ringing calls as missed
  async cleanupStaleCalls(req: AuthRequest, res: Response) {
    const result = await callService.cleanupStaleCalls();
    res.json({ message: 'Cleanup completed', ...result });
  },
};
