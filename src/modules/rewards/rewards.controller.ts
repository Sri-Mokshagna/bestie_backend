import { Request, Response } from 'express';
import { User } from '../../models/User';
import crypto from 'crypto';

// Get user's rewards data
export const getRewards = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate referral code if not exists
        if (!user.referralCode) {
            user.referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
            await user.save();
        }

        // Count referrals
        const referralCount = await User.countDocuments({ referredBy: user.referralCode });

        res.json({
            points: user.rewardPoints || 0,
            referralCode: user.referralCode,
            referralCount,
        });
    } catch (error) {
        console.error('Get rewards error:', error);
        res.status(500).json({ error: 'Failed to fetch rewards data' });
    }
};

// Redeem reward - convert all points to coins freely (no tier restrictions)
export const redeemReward = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { pointsToRedeem, coinsToReceive } = req.body;

        if (!pointsToRedeem || !coinsToReceive) {
            return res.status(400).json({ error: 'Points to redeem and coins to receive are required' });
        }

        if (pointsToRedeem <= 0 || coinsToReceive <= 0) {
            return res.status(400).json({ error: 'Points and coins must be positive values' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if user has enough points
        if ((user.rewardPoints || 0) < pointsToRedeem) {
            return res.status(400).json({ error: 'Insufficient reward points' });
        }

        // Deduct points and add coins — no tier restrictions
        user.rewardPoints = (user.rewardPoints || 0) - pointsToRedeem;
        user.coinBalance += coinsToReceive;
        await user.save();

        res.json({
            message: 'Reward redeemed successfully',
            coinsAdded: coinsToReceive,
            coinBalance: user.coinBalance,
            remainingPoints: user.rewardPoints,
        });
    } catch (error) {
        console.error('Redeem reward error:', error);
        res.status(500).json({ error: 'Failed to redeem reward' });
    }
};
