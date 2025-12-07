import { Request, Response } from 'express';
import { User, UserRole } from '../../models/User';

// Get responders with voice recordings
export const getRespondersWithVoiceRecordings = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        const responders = await User.find({
            role: UserRole.RESPONDER,
            'profile.voiceBlob': { $exists: true, $ne: null, $ne: '' }
        })
            .select('profile phone createdAt')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));

        const total = await User.countDocuments({
            role: UserRole.RESPONDER,
            'profile.voiceBlob': { $exists: true, $ne: null, $ne: '' }
        });

        res.json({
            responders: responders.map(r => ({
                id: r._id,
                name: r.profile?.name || r.phone,
                phone: r.phone,
                voiceBlob: r.profile?.voiceBlob,
                voiceText: r.profile?.voiceText,
                createdAt: r.createdAt
            })),
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (error) {
        console.error('Get voice recordings error:', error);
        res.status(500).json({ error: 'Failed to fetch voice recordings' });
    }
};

// Delete responder account (admin only)
export const deleteResponderAccount = async (req: Request, res: Response) => {
    try {
        const { responderId } = req.params;

        const responder = await User.findById(responderId);
        if (!responder) {
            return res.status(404).json({ error: 'Responder not found' });
        }

        if (responder.role !== UserRole.RESPONDER) {
            return res.status(400).json({ error: 'User is not a responder' });
        }

        // Delete the responder
        await User.findByIdAndDelete(responderId);

        console.log(`Admin deleted responder: ${responderId}`);

        res.json({
            success: true,
            message: 'Responder account deleted successfully'
        });
    } catch (error) {
        console.error('Delete responder error:', error);
        res.status(500).json({ error: 'Failed to delete responder' });
    }
};
