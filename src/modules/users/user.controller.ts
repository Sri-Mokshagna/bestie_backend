import { Request, Response } from 'express';
import { User, UserRole } from '../../models/User';
import { Call } from '../../models/Call';

// Get all users (for responder to discover and message)
export const getAllUsers = async (req: Request, res: Response) => {
    try {
        // Only responders should access this
        if (req.user?.role !== UserRole.RESPONDER) {
            return res.status(403).json({ error: 'Only responders can access user list' });
        }

        const users = await User.find({
            role: UserRole.USER,
        })
            .select('profile.name profile.avatar')
            .sort({ 'profile.name': 1 })
            .lean();

        res.json({
            users: users.map((u: any) => ({
                id: u._id.toString(),
                name: u.profile?.name || 'User',
                avatar: u.profile?.avatar || null,
            })),
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
};

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

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('🗑️ Deleting account for user:', { userId, phone: user.phone, role: user.role });

        // Import models for cleanup
        const { Responder } = require('../../models/Responder');
        const { Call } = require('../../models/Call');
        const { Chat, Message } = require('../../models/Chat');
        const { Transaction } = require('../../models/Transaction');
        const { Payout } = require('../../models/Payout');

        // Clean up all related data (use allSettled so one failure doesn't block others)
        const cleanupResults = await Promise.allSettled([
            // Delete Responder doc if exists
            Responder.findOneAndDelete({ userId }),
            // Delete calls
            Call.deleteMany({ $or: [{ userId }, { responderId: userId }] }),
            // Delete chats and messages
            Chat.find({ participants: userId }).then(async (chats: any[]) => {
                const chatIds = chats.map((c: any) => c._id);
                if (chatIds.length > 0) {
                    await Message.deleteMany({ chatId: { $in: chatIds } });
                    await Chat.deleteMany({ _id: { $in: chatIds } });
                }
            }),
            // Delete transactions
            Transaction.deleteMany({ $or: [{ userId }, { responderId: userId }] }),
            // Delete payouts
            Payout.deleteMany({ responderId: userId }),
        ]);

        // Log any cleanup failures (non-blocking)
        const failures = cleanupResults.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            console.error('⚠️ Some cleanup operations failed during account deletion:', {
                userId,
                failures: failures.map((f: any) => f.reason?.message || f.reason),
            });
        }

        // Delete the Firebase Auth user (so re-registration gets a clean slate)
        if (user.firebaseUid) {
            try {
                const { admin } = require('../../lib/firebase');
                await admin.auth().deleteUser(user.firebaseUid);
                console.log('✅ Firebase user deleted:', user.firebaseUid);
            } catch (firebaseError: any) {
                // Don't fail the deletion if Firebase cleanup fails
                console.error('⚠️ Failed to delete Firebase user (non-blocking):', firebaseError.message);
            }
        }

        // Finally, delete the User document
        await User.findByIdAndDelete(userId);

        console.log('✅ Account deleted successfully:', { userId, phone: user.phone });

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
