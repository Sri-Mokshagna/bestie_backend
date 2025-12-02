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

        // Calculate reward points (example: 10 points per referral)
        const points = referralCount * 10;

        res.json({
            points,
            referralCode: user.referralCode,
            referralCount,
        });
    } catch (error) {
        console.error('Get rewards error:', error);
        res.status(500).json({ error: 'Failed to fetch rewards data' });
    }
};

// Redeem reward
export const redeemReward = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { rewardType, pointsCost } = req.body;

        if (!rewardType || !pointsCost) {
            return res.status(400).json({ error: 'Reward type and points cost are required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Count referrals
        const referralCount = await User.countDocuments({ referredBy: user.referralCode });
        const points = referralCount * 10;

        if (points < pointsCost) {
            return res.status(400).json({ error: 'Insufficient reward points' });
        }

        // Determine coins based on reward type
        let coinsToAdd = 0;
        if (rewardType === '50_coins' && pointsCost === 100) {
            coinsToAdd = 50;
        } else if (rewardType === '100_coins' && pointsCost === 200) {
            coinsToAdd = 100;
        } else if (rewardType === '250_coins' && pointsCost === 500) {
            coinsToAdd = 250;
        } else {
            return res.status(400).json({ error: 'Invalid reward type' });
        }

        // Add coins to user
        user.coinBalance += coinsToAdd;
        await user.save();

        res.json({
            message: 'Reward redeemed successfully',
            coinsAdded: coinsToAdd,
            newBalance: user.coinBalance,
        });
    } catch (error) {
        console.error('Redeem reward error:', error);
        res.status(500).json({ error: 'Failed to redeem reward' });
    }
};
