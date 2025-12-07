import { Request, Response } from 'express';
import { User } from '../../models/User';

export const blockUser = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { blockedUserId } = req.body;

        if (!blockedUserId) {
            return res.status(400).json({ error: 'blockedUserId is required' });
        }

        // Find the current user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Initialize blockedUsers array if it doesn't exist
        if (!user.blockedUsers) {
            user.blockedUsers = [];
        }

        // Add to blocked list if not already blocked
        if (!user.blockedUsers.includes(blockedUserId)) {
            user.blockedUsers.push(blockedUserId);
            await user.save();
        }

        res.json({
            success: true,
            message: 'User blocked successfully',
            blockedUsers: user.blockedUsers
        });
    } catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({ error: 'Failed to block user' });
    }
};

export const un blockUser = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { unblockedUserId } = req.body;

        if (!unblockedUserId) {
            return res.status(400).json({ error: 'unblockedUserId is required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Remove from blocked list
        if (user.blockedUsers) {
            user.blockedUsers = user.blockedUsers.filter(id => id !== unblockedUserId);
            await user.save();
        }

        res.json({
            success: true,
            message: 'User unblocked successfully',
            blockedUsers: user.blockedUsers || []
        });
    } catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({ error: 'Failed to unblock user' });
    }
};

export const getBlockedUsers = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        const user = await User.findById(userId).select('blockedUsers');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Populate blocked users with basic info
        const blockedUsers = await User.find({
            _id: { $in: user.blockedUsers || [] }
        }).select('profile phone');

        res.json({ blockedUsers });
    } catch (error) {
        console.error('Get blocked users error:', error);
        res.status(500).json({ error: 'Failed to fetch blocked users' });
    }
};
