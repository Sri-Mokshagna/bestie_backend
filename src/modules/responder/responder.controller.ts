import { Request, Response } from 'express';
import { responderService } from './responder.service';
import { AuthRequest } from '../../middleware/auth';

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
};
