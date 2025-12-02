import { Request, Response } from 'express';
import { User } from '../../models/User';
import { Call } from '../../models/Call';

// Get blocked users
export const getBlockedUsers = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get blocked user details
        const blockedUsers = await User.find({
            _id: { $in: user.blockedUsers || [] }
        }).select('phone profile.name profile.avatar');

        res.json({ blockedUsers });
    } catch (error) {
        console.error('Get blocked users error:', error);
        res.status(500).json({ error: 'Failed to fetch blocked users' });
    }
};

// Block a user
export const blockUser = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { userId: targetUserId } = req.params;

        if (userId === targetUserId) {
            return res.status(400).json({ error: 'Cannot block yourself' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Initialize blockedUsers array if not exists
        if (!user.blockedUsers) {
            user.blockedUsers = [];
        }

        // Check if already blocked
        if (user.blockedUsers.includes(targetUserId)) {
            return res.status(400).json({ error: 'User already blocked' });
        }

        // Add to blocked list
        user.blockedUsers.push(targetUserId);
        await user.save();

        res.json({ message: 'User blocked successfully' });
    } catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({ error: 'Failed to block user' });
    }
};

// Unblock a user
export const unblockUser = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { userId: targetUserId } = req.params;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Remove from blocked list
        user.blockedUsers = (user.blockedUsers || []).filter(
            (id: any) => id.toString() !== targetUserId
        );
        await user.save();

        res.json({ message: 'User unblocked successfully' });
    } catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({ error: 'Failed to unblock user' });
    }
};

// Delete account
export const deleteAccount = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        // Delete user data
        await User.findByIdAndDelete(userId);

        // Optionally: Clean up related data
        // await Call.deleteMany({ $or: [{ userId }, { responderId: userId }] });
        // await Chat.deleteMany({ participants: userId });

        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
};

// Update profile
export const updateProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { language, name, gender, avatar } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update profile fields
        if (language !== undefined) {
            user.profile.language = language;
        }
        if (name !== undefined) {
            user.profile.name = name;
        }
        if (gender !== undefined) {
            user.profile.gender = gender;
        }
        if (avatar !== undefined) {
            user.profile.avatar = avatar;
        }

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                phone: user.phone,
                role: user.role,
                profile: user.profile,
                coinBalance: user.coinBalance,
                status: user.status,
                createdAt: user.createdAt,
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};
