import { Request, Response } from 'express';
import { User, UserRole } from '../../models/User';

export const getReportedUsers = async (req: Request, res: Response) => {
    try {
        // TODO: Create Report model and fetch actual reports
        // For now returning empty array - this needs Report model implementation

        res.json({
            reports: [],
            message: 'Reports endpoint ready - needs Report model implementation'
        });
    } catch (error) {
        console.error('Get reported users error:', error);
        res.status(500).json({ error: 'Failed to fetch reported users' });
    }
};
