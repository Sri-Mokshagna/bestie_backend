import { Request, Response } from 'express';
import { User, UserRole } from '../../models/User';
import { Responder, KycStatus } from '../../models/Responder';
import { logger } from '../../lib/logger';

// Get responders with voice recordings
export const getRespondersWithVoiceRecordings = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 1000 } = req.query; // Increased from 20 to 1000 to show all records

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
            // APPROVE: Update verification status in User AND activate in Responder
            responder.profile = responder.profile || {};
            responder.profile.voiceVerificationStatus = 'approved';
            responder.profile.voiceVerifiedAt = new Date();
            await responder.save();

            // CRITICAL: Also update Responder model to activate for calls
            // Without this, responder won't appear in available responders list!
            const responderDoc = await Responder.findOne({ userId: responderId });
            if (responderDoc) {
                responderDoc.kycStatus = KycStatus.VERIFIED; // This makes them active!
                await responderDoc.save();

                logger.info({
                    responderId,
                    responderName: responder.profile?.name || responder.phone,
                    kycStatus: responderDoc.kycStatus,
                    action: 'responder_activated'
                }, '✅ Responder voice approved and activated for calls');
            } else {
                logger.warn({
                    responderId,
                    responderName: responder.profile?.name || responder.phone,
                }, '⚠️ Voice approved but no Responder document found - user cannot receive calls!');
            }

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
            // REJECT: Delete the responder account and ALL related data
            const responderName = responder.profile?.name || responder.phone;

            logger.warn({
                responderId,
                responderName,
                responderRole: responder.role,
                action: 'about_to_delete_responder'
            }, 'Admin is about to reject and delete RESPONDER account');

            try {
                // Import models for cleanup (lazy import to avoid circular dependencies)
                const { Call } = await import('../../models/Call');
                const { Chat, Message } = await import('../../models/Chat');
                const { Transaction } = await import('../../models/Transaction');
                const { Payout } = await import('../../models/Payout');

                // Delete all related data for this responder
                const cleanupResults = await Promise.allSettled([
                    // Delete calls where responder was involved
                    Call.deleteMany({ responderId }),

                    // Delete chats involving this responder
                    Chat.find({ participants: responderId }).then(async (chats) => {
                        const chatIds = chats.map(c => c._id);
                        await Message.deleteMany({ chatId: { $in: chatIds } });
                        await Chat.deleteMany({ _id: { $in: chatIds } });
                    }),

                    // Delete transactions related to this responder
                    Transaction.deleteMany({ responderId }),

                    // Delete payout requests
                    Payout.deleteMany({ responderId }),

                    // Delete responder document
                    Responder.findOneAndDelete({ userId: responderId }),
                ]);

                // Log cleanup results
                const failures = cleanupResults.filter(r => r.status === 'rejected');
                if (failures.length > 0) {
                    logger.error({
                        responderId,
                        responderName,
                        failures: failures.map(f => f.reason),
                    }, '⚠️ Some cleanup operations failed during responder deletion');
                } else {
                    logger.info({
                        responderId,
                        responderName,
                    }, '✅ All related data cleaned up successfully');
                }

                // Finally, delete the user account
                const deletedUser = await User.findByIdAndDelete(responderId);

                if (!deletedUser) {
                    logger.error({ responderId }, '❌ User not found or already deleted');
                    return res.status(404).json({ error: 'Responder not found or already deleted' });
                }

                logger.warn({
                    responderId,
                    responderName,
                    action: 'voice_rejected_and_deleted',
                    cleanupSuccess: failures.length === 0
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
            } catch (cleanupError) {
                logger.error({
                    responderId,
                    responderName,
                    error: cleanupError,
                    stack: (cleanupError as Error).stack
                }, '❌ Critical error during responder deletion cleanup');

                // Still try to delete the user even if cleanup partially failed
                await User.findByIdAndDelete(responderId);

                res.json({
                    success: true,
                    message: 'Responder deleted but some cleanup operations may have failed',
                    responder: {
                        id: responderId,
                        name: responderName,
                        role: UserRole.RESPONDER,
                        status: 'rejected_and_deleted'
                    }
                });
            }
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

// Block/Unblock responder (temporarily suspend without deleting)
export const blockResponder = async (req: Request, res: Response) => {
    try {
        const { responderId } = req.params;
        const { blocked } = req.body;

        if (typeof blocked !== 'boolean') {
            return res.status(400).json({ error: 'blocked must be a boolean' });
        }

        const responder = await User.findById(responderId);
        if (!responder) {
            return res.status(404).json({ error: 'Responder not found' });
        }

        if (responder.role !== UserRole.RESPONDER) {
            return res.status(400).json({ error: 'User is not a responder' });
        }

        // Update voice verification status to blocked
        responder.profile = responder.profile || {};
        responder.profile.voiceVerificationStatus = blocked ? 'rejected' : 'approved';
        await responder.save();

        // Update Responder model kycStatus
        const responderDoc = await Responder.findOne({ userId: responderId });
        if (responderDoc) {
            responderDoc.kycStatus = blocked ? KycStatus.REJECTED : KycStatus.VERIFIED;
            responderDoc.isOnline = false; // Set offline when blocked
            await responderDoc.save();

            logger.info({
                responderId,
                responderName: responder.profile?.name || responder.phone,
                action: blocked ? 'blocked' : 'unblocked',
                kycStatus: responderDoc.kycStatus
            }, `Admin ${blocked ? 'blocked' : 'unblocked'} responder`);
        }

        res.json({
            success: true,
            message: `Responder ${blocked ? 'blocked' : 'unblocked'} successfully`,
            responder: {
                id: responder._id,
                name: responder.profile?.name || responder.phone,
                status: blocked ? 'blocked' : 'active'
            }
        });
    } catch (error) {
        logger.error({ error, responderId: req.params.responderId }, 'Block responder error');
        res.status(500).json({ error: 'Failed to block/unblock responder' });
    }
};

