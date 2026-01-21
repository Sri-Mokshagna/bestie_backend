import { Request, Response } from 'express';
import { User, UserRole } from '../../models/User';
import { Responder } from '../../models/Responder';
import { logger } from '../../lib/logger';

// Get responders with voice recordings
export const getRespondersWithVoiceRecordings = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        const responders = await User.find({
            role: UserRole.RESPONDER,
            'profile.voiceBlob': { $exists: true, $nin: [null, ''] }
        })
            .select('profile phone createdAt')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));

        const total = await User.countDocuments({
            role: UserRole.RESPONDER,
            'profile.voiceBlob': { $exists: true, $nin: [null, ''] }
        });

        res.json({
            responders: responders.map(r => ({
                id: r._id,
                name: r.profile?.name || r.phone,
                phone: r.phone,
                voiceBlob: r.profile?.voiceBlob,
                voiceText: r.profile?.voiceText,
                verificationStatus: r.profile?.voiceVerificationStatus || 'pending',
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

// Verify voice recording (approve or reject) - RESPONDERS ONLY
export const verifyVoiceRecording = async (req: Request, res: Response) => {
    try {
        const { responderId } = req.params;
        const { approved } = req.body;

        if (typeof approved !== 'boolean') {
            return res.status(400).json({ error: 'approved must be a boolean' });
        }

        const responder = await User.findById(responderId);
        if (!responder) {
            return res.status(404).json({ error: 'Responder not found' });
        }

        // CRITICAL: Only responders can have voice recordings verified
        // This prevents accidentally verifying/deleting regular users
        if (responder.role !== UserRole.RESPONDER) {
            logger.error({
                responderId,
                actualRole: responder.role,
                attemptedBy: req.user?.id
            }, 'Attempted to verify voice for non-responder user');

            return res.status(400).json({
                error: 'This endpoint is only for responders. The specified user is not a responder.'
            });
        }

        // Additional safety: Check if user has a voice recording
        if (!responder.profile?.voiceBlob) {
            return res.status(400).json({
                error: 'This responder has no voice recording to verify'
            });
        }

        if (approved) {
            // APPROVE: Update verification status
            responder.profile = responder.profile || {};
            responder.profile.voiceVerificationStatus = 'approved';
            responder.profile.voiceVerifiedAt = new Date();
            await responder.save();

            logger.info({
                responderId,
                responderName: responder.profile?.name || responder.phone,
                responderRole: responder.role,
                action: 'voice_approved'
            }, 'Admin approved RESPONDER voice recording');

            res.json({
                success: true,
                message: 'Responder voice recording approved successfully',
                responder: {
                    id: responder._id,
                    name: responder.profile?.name || responder.phone,
                    role: responder.role,
                    status: 'approved'
                }
            });
        } else {
            // REJECT: Delete the responder account
            const responderName = responder.profile?.name || responder.phone;

            logger.warn({
                responderId,
                responderName,
                responderRole: responder.role,
                action: 'about_to_delete_responder'
            }, 'Admin is about to reject and delete RESPONDER account');

            // Delete responder data if it exists
            await Responder.findOneAndDelete({ userId: responderId });

            // Delete user account
            await User.findByIdAndDelete(responderId);

            logger.warn({
                responderId,
                responderName,
                action: 'voice_rejected_and_deleted'
            }, 'Admin rejected RESPONDER voice recording and deleted account');

            res.json({
                success: true,
                message: 'Responder voice recording rejected and account deleted',
                responder: {
                    id: responderId,
                    name: responderName,
                    role: UserRole.RESPONDER,
                    status: 'rejected_and_deleted'
                }
            });
        }
    } catch (error) {
        logger.error({ error, responderId: req.params.responderId }, 'Verify voice recording error');
        res.status(500).json({ error: 'Failed to verify voice recording' });
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
