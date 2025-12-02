import { Request, Response } from 'express';
import { Payment } from '../../models/Payment';
import { Redemption } from '../../models/Redemption';
import { UserRole } from '../../models/User';

// Get user's transaction history
export const getTransactions = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const userRole = req.user?.role;
        const { page = 1, limit = 20 } = req.query;

        let transactions: any[] = [];

        if (userRole === UserRole.USER) {
            // For users, get payment history (coins bought)
            const payments = await Payment.find({ userId })
                .sort({ createdAt: -1 })
                .limit(Number(limit))
                .skip((Number(page) - 1) * Number(limit))
                .select('amount coins status createdAt paymentMethod orderId');

            transactions = payments.map(payment => ({
                _id: payment._id,
                type: 'purchase',
                amount: payment.amount,
                coins: payment.coins,
                status: payment.status,
                createdAt: payment.createdAt,
                paymentMethod: payment.paymentMethod,
                orderId: payment.orderId,
            }));
        } else if (userRole === UserRole.RESPONDER) {
            // For responders, get redemption history (coins redeemed)
            const redemptions = await Redemption.find({ userId })
                .sort({ createdAt: -1 })
                .limit(Number(limit))
                .skip((Number(page) - 1) * Number(limit))
                .select('coinsToRedeem amountINR status createdAt upiId');

            transactions = redemptions.map(redemption => ({
                _id: redemption._id,
                type: 'redemption',
                amount: redemption.amountINR,
                coins: redemption.coinsToRedeem,
                status: redemption.status,
                createdAt: redemption.createdAt,
                paymentMethod: 'UPI',
                upiId: redemption.upiId,
            }));
        }

        const total = userRole === UserRole.USER
            ? await Payment.countDocuments({ userId })
            : await Redemption.countDocuments({ userId });

        res.json({
            transactions,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
};
