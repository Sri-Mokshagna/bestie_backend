import crypto from 'crypto';
import { Call, CallType, CallStatus } from '../../models/Call';
import { User, UserRole, UserStatus } from '../../models/User';
import { Chat, Message, MessageType } from '../../models/Chat';
import { Transaction, TransactionType, TransactionStatus } from '../../models/Transaction';
import { Responder } from '../../models/Responder';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../lib/logger';
import { emitToUser } from '../../lib/socket';
import { coinService } from '../../services/coinService';
import { commissionService } from '../../services/commissionService';
import { pushNotificationService } from '../../services/pushNotificationService';

// Store active call timers to cancel if call ends early
const callTimers = new Map<string, NodeJS.Timeout>();

export const callService = {
  async initiateCall(userId: string, responderId: string, type: CallType) {
    // PERFORMANCE: Parallel fetch of user and config
    const [user, config] = await Promise.all([
      User.findById(userId),
      coinService.getConfig(),
    ]);

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Check if call type is enabled
    const featureName = type === CallType.AUDIO ? 'audioCall' : 'videoCall';
    const isEnabled = type === CallType.AUDIO ? config.audioCallEnabled : config.videoCallEnabled;
    if (!isEnabled) {
      throw new AppError(403, `${type} calls are currently disabled`, 'FEATURE_DISABLED');
    }

    // Check if user has sufficient coins for at least 1 minute
    const minDuration = 60; // 1 minute in seconds
    const ratePerMinute = type === CallType.AUDIO
      ? config.audioCallCoinsPerMinute
      : config.videoCallCoinsPerMinute;
    const minCoinsRequired = Math.ceil((ratePerMinute / 60) * minDuration);

    if (user.coinBalance < minCoinsRequired) {
      throw new AppError(
        400,
        `Insufficient coins. You need at least ${minCoinsRequired} coins for a ${type} call.`,
        'INSUFFICIENT_COINS'
      );
    }

    // PERFORMANCE: Parallel fetch of responder user and profile
    const [responderUser, responderProfile] = await Promise.all([
      User.findById(responderId),
      Responder.findOne({ userId: responderId }),
    ]);
    if (!responderUser) {
      throw new AppError(404, 'Responder not found');
    }

    if (responderUser.role !== UserRole.RESPONDER) {
      throw new AppError(400, 'Selected user is not a responder');
    }

    if (responderUser.status !== UserStatus.ACTIVE) {
      throw new AppError(400, 'Responder account is not active');
    }

    // Check if responder is online - consider both isOnline AND availability flags
    const hasAnyAvailabilityEnabled = responderUser.audioEnabled || responderUser.videoEnabled || responderUser.chatEnabled;
    const effectivelyOnline = responderUser.isOnline || hasAnyAvailabilityEnabled;

    if (!effectivelyOnline) {
      throw new AppError(400, 'Responder is currently offline', 'RESPONDER_OFFLINE');
    }

    // Check if responder is available for this type of call
    // Lazy-create Responder document if missing to handle edge cases
    let responderProfileDoc = responderProfile;

    if (!responderProfileDoc) {
      // Create missing Responder document with default settings from User model
      logger.warn({ responderId }, 'Responder profile missing during call initiation, creating with defaults');

      responderProfileDoc = await Responder.create({
        userId: responderId,
        isOnline: responderUser.isOnline,
        kycStatus: 'verified', // Assume verified since they're an active responder
        earnings: {
          totalCoins: 0,
          pendingCoins: 0,
          lockedCoins: 0,
          redeemedCoins: 0,
        },
        rating: 0,
        audioEnabled: responderUser.audioEnabled ?? true,
        videoEnabled: responderUser.videoEnabled ?? true,
        chatEnabled: responderUser.chatEnabled ?? true,
      });
    }

    // Now ALWAYS check availability (document guaranteed to exist)
    if (type === CallType.AUDIO && !responderProfileDoc.audioEnabled) {
      throw new AppError(400, 'Responder is not available for audio calls', 'RESPONDER_NOT_AVAILABLE');
    }
    if (type === CallType.VIDEO && !responderProfileDoc.videoEnabled) {
      throw new AppError(400, 'Responder is not available for video calls', 'RESPONDER_NOT_AVAILABLE');
    }

    // CRITICAL: Set inCall flag early to prevent concurrent calls
    // Only one call can ring at a time - subsequent calls get clear "busy" message
    // DEFENSE: Using atomic findOneAndUpdate ensures only ONE concurrent call wins
    // The condition {inCall: false} acts as a distributed lock
    const inCallUpdateResult = await User.findOneAndUpdate(
      {
        _id: responderId,
        inCall: false  // Only update if not already in call - ATOMIC CHECK-AND-SET
      },
      { inCall: true },
      { new: true }
    );

    if (!inCallUpdateResult) {
      // Another call is already ringing - responder is busy
      logger.info({
        userId,
        responderId,
        reason: 'inCall flag already set'
      }, 'Call blocked: Responder already has incoming call');
      throw new AppError(400, 'Responder is currently in another call', 'RESPONDER_IN_CALL');
    }

    // ISSUE 3 FIX: Also set in Responder document for consistency
    // DEFENSE: This is a SECONDARY sync only - User.inCall is the authoritative lock
    // Even if this fails, the User.inCall flag protects against concurrent calls
    await Responder.findOneAndUpdate(
      { userId: responderId },
      { inCall: true }
    ).catch(err => {
      // Non-critical - User.inCall is the authoritative source
      logger.warn({ responderId, error: err.message }, 'Failed to sync Responder.inCall (non-critical)');
    });

    logger.info({
      userId,
      responderId,
      type
    }, 'inCall flag set - call can proceed');

    // Check if responder has blocked this user
    if (responderUser.blockedUsers?.includes(userId)) {
      throw new AppError(403, 'This responder is not available', 'BLOCKED');
    }

    // Check if responder is available (not busy with another call)
    // Block ALL calls (RINGING, CONNECTING, ACTIVE) - only one at a time
    const activeCall = await Call.findOne({
      responderId: responderId,
      status: { $in: [CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
    });

    if (activeCall) {
      const now = new Date();
      const callAge = now.getTime() - activeCall.createdAt.getTime();

      // Auto-cleanup stale calls based on status
      if (activeCall.status === CallStatus.RINGING && callAge > 60000) {
        // RINGING calls older than 60 seconds - mark as missed
        logger.info({ callId: String(activeCall._id) }, 'Auto-ending stale RINGING call');
        activeCall.status = CallStatus.MISSED;
        activeCall.endTime = now;
        await activeCall.save();

        // CRITICAL: Clear inCall flag for stale RINGING calls
        await User.findByIdAndUpdate(activeCall.responderId, { inCall: false });
        await Responder.findOneAndUpdate({ userId: activeCall.responderId }, { inCall: false });
      } else if (
        (activeCall.status === CallStatus.CONNECTING || activeCall.status === CallStatus.ACTIVE) &&
        callAge > 300000 // 5 minutes
      ) {
        // CONNECTING/ACTIVE calls older than 5 minutes - likely stale
        logger.info({ callId: String(activeCall._id) }, 'Auto-ending stale CONNECTING/ACTIVE call');
        activeCall.status = CallStatus.ENDED;
        activeCall.endTime = now;
        await activeCall.save();

        // Clear inCall flag for stale ACTIVE calls
        await User.findByIdAndUpdate(activeCall.responderId, { inCall: false });
        await Responder.findOneAndUpdate({ userId: activeCall.responderId }, { inCall: false });
      } else {
        // Call is recent, responder is genuinely busy
        throw new AppError(400, 'Responder is in another call', 'RESPONDER_IN_CALL');
      }
    }

    // Generate ZEGOCLOUD room ID
    const zegoRoomId = this.generateRoomId();

    // Create call record
    const call = await Call.create({
      userId,
      responderId: responderUser._id,
      type,
      zegoRoomId,
      status: CallStatus.RINGING,
    });

    // Get names for display
    const callerName = user.profile?.name || user.phone || 'Unknown';
    const receiverName = responderUser.profile?.name || responderUser.phone || 'Responder';

    // NOTIFICATION STRATEGY: Dual-path for maximum reliability
    // Send BOTH socket and FCM simultaneously - whichever delivers first wins

    // Get socket connection status
    const { isUserConnected } = require('../../lib/socket');
    const hasActiveSocket = isUserConnected(responderUser._id.toString());

    // 1. Socket notification (instant if connected)
    emitToUser(responderUser._id.toString(), 'incoming_call', {
      callId: String(call._id),
      userId: userId, // ADD: Consistent field naming
      responderId: String(responderUser._id), // ADD: For proper call tracking
      callerId: userId, // Keep for backwards compatibility
      callerName,
      callType: type,
      zegoRoomId: call.zegoRoomId,
    });

    // 2. FCM notification (ALWAYS send, not just fallback)
    // FCM is reliable under concurrent load and works even if app killed
    if (responderUser.fcmToken) {
      // Fire-and-forget - don't block response
      pushNotificationService.sendIncomingCallNotification(
        responderUser.fcmToken,
        {
          callId: String(call._id),
          userId: userId, // ADD: For consistent tracking
          responderId: String(responderUser._id), // ADD: Responder's ID
          callerId: userId, // Keep for backwards compatibility
          callerName,
          callType: type === CallType.AUDIO ? 'audio' : 'video',
          zegoRoomId: call.zegoRoomId,
        }
      ).then((success) => {
        if (success) {
          logger.info({
            callId: String(call._id),
            hasSocket: hasActiveSocket,
          }, '✅ FCM notification sent successfully');
        } else {
          logger.warn({
            callId: String(call._id),
            hasSocket: hasActiveSocket,
          }, '⚠️ FCM failed - relying on socket notification');
        }
      }).catch(err => {
        logger.error({
          error: err,
          callId: String(call._id),
          hasSocket: hasActiveSocket,
        }, '❌ FCM notification error');
      });
    } else {
      // No FCM token - socket is only option
      if (!hasActiveSocket) {
        logger.error({
          callId: String(call._id),
          responderId: responderUser._id.toString(),
          responderPhone: responderUser.phone,
          responderName: responderUser.profile?.name || 'Unknown',
        }, '🚨 CRITICAL: No FCM token AND no socket - notification will fail!');
      } else {
        logger.warn({
          callId: String(call._id),
          responderId: responderUser._id.toString(),
          responderPhone: responderUser.phone,
        }, '⚠️ No FCM token - relying on socket only');
      }
    }

    // ENHANCED LOGGING: Log complete notification delivery status
    logger.info({
      callId: String(call._id),
      userId,
      responderId: responderUser._id.toString(),
      responderPhone: responderUser.phone,
      responderName: receiverName,
      hasFcmToken: !!responderUser.fcmToken,
      hasSocket: hasActiveSocket,
      fcmTokenPrefix: responderUser.fcmToken?.substring(0, 15),
      notificationStrategy: responderUser.fcmToken && hasActiveSocket ? 'dual' :
        responderUser.fcmToken ? 'fcm-only' :
          hasActiveSocket ? 'socket-only' : 'NONE',
    }, '📞 Call initiated - notification delivery status');

    // OPTION 1 FIX: Schedule FCM retry if call still RINGING after 5 seconds
    // DEFENSE: This is ADDITIVE - runs in background, doesn't block response
    // Only retries FCM, doesn't affect socket or existing call flow
    if (responderUser.fcmToken) {
      setTimeout(async () => {
        try {
          const currentCall = await Call.findById(call._id);
          if (currentCall && currentCall.status === CallStatus.RINGING) {
            logger.info({ callId: String(call._id) }, '🔄 Call still RINGING after 5s - retrying FCM notification');
            
            // Retry FCM notification
            pushNotificationService.sendIncomingCallNotification(
              responderUser.fcmToken!,
              {
                callId: String(call._id),
                userId: userId,
                responderId: String(responderUser._id),
                callerId: userId,
                callerName,
                callType: type === CallType.AUDIO ? 'audio' : 'video',
                zegoRoomId: call.zegoRoomId,
              }
            ).then(success => {
              if (success) {
                logger.info({ callId: String(call._id) }, '✅ FCM retry successful');
              }
            }).catch(err => {
              logger.warn({ callId: String(call._id), error: err.message }, '⚠️ FCM retry failed');
            });
          }
        } catch (err: any) {
          // Non-critical - don't crash server
          logger.debug({ callId: String(call._id), error: err.message }, 'FCM retry check failed (non-critical)');
        }
      }, 5000); // 5 second delay
    }

    return call;
  },

  async acceptCall(callId: string, responderId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.responderId.toString() !== responderId) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status !== CallStatus.RINGING) {
      throw new AppError(400, 'Call is not in ringing state');
    }

    // Update call status to CONNECTING (not ACTIVE yet)
    call.status = CallStatus.CONNECTING;
    await call.save();

    // Set inCall flag when call is accepted (prevents new calls from ringing)
    await User.findByIdAndUpdate(call.responderId, { inCall: true });
    await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: true });

    logger.info({
      callId: String(call._id),
      responderId: call.responderId.toString(),
    }, 'inCall flag set - call accepted and connecting');

    // Auto-reject any other RINGING calls to this responder
    // This handles the case where multiple users called simultaneously
    const otherRingingCalls = await Call.find({
      _id: { $ne: call._id }, // Not this call
      responderId: call.responderId,
      status: CallStatus.RINGING,
    });

    if (otherRingingCalls.length > 0) {
      logger.info({
        callId: String(call._id),
        otherCallsCount: otherRingingCalls.length,
      }, 'Auto-rejecting other ringing calls');

      // Reject all other ringing calls
      for (const otherCall of otherRingingCalls) {
        otherCall.status = CallStatus.MISSED;
        otherCall.endTime = new Date();
        await otherCall.save();

        // Notify the caller that responder answered another call
        emitToUser(otherCall.userId.toString(), 'call_ended', {
          callId: String(otherCall._id),
          reason: 'responder_answered_another_call',
        });

        logger.info({
          rejectedCallId: String(otherCall._id),
          acceptedCallId: String(call._id),
        }, 'Other ringing call auto-rejected');
      }
    }

    // Notify caller that call was accepted and is connecting
    emitToUser(call.userId.toString(), 'call_accepted', {
      callId: String(call._id),
      status: 'connecting',
    });

    // Don't start metering yet - wait for both parties to connect
    // Metering will start when call moves to ACTIVE status

    return call;
  },

  async confirmCallConnection(callId: string, userId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.userId.toString() !== userId && call.responderId.toString() !== userId) {
      throw new AppError(403, 'Not authorized');
    }

    // 🔥 IDEMPOTENCY FIX: If call is already ACTIVE, just re-emit the connected event
    // This handles the case where both parties call confirmCallConnection()
    // Second caller should still receive the call_connected event with timing info
    if (call.status === CallStatus.ACTIVE && call.startTime && call.maxDurationSeconds) {
      logger.info(
        {
          callId: String(call._id),
          userId,
          status: call.status,
        },
        '🔄 Call already active - re-emitting call_connected (idempotent retry)'
      );

      const startTimeMs = call.startTime.getTime();

      // Always emit to BOTH parties (ensure both have the timing info)
      emitToUser(call.userId.toString(), 'call_connected', {
        callId: String(call._id),
        maxDuration: call.maxDurationSeconds,
        startTimeMs,
      });
      emitToUser(call.responderId.toString(), 'call_connected', {
        callId: String(call._id),
        maxDuration: call.maxDurationSeconds,
        startTimeMs,
      });

      return call;
    }

    // CRITICAL: Strict validation - call MUST be in CONNECTING state for first-time activation
    // This prevents premature activation before responder joins Zego room
    if (call.status !== CallStatus.CONNECTING) {
      logger.warn(
        { callId, userId, currentStatus: call.status },
        '⚠️ REJECTED confirmCallConnection - call not in CONNECTING state'
      );
      throw new AppError(400, `Call is not in connecting state. Current status: ${call.status}`);
    }

    logger.info(
      { callId, userId, status: call.status },
      '✅ confirmCallConnection - call is CONNECTING, proceeding with activation'
    );

    // Get user's current coin balance
    const user = await User.findById(call.userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Calculate max duration from available coins
    const callType = call.type === CallType.AUDIO ? 'audio' : 'video';
    const rate = await coinService.getCallRate(callType);

    // Calculate max seconds (rate is coins per minute, convert to seconds)
    const maxDurationSeconds = Math.floor((user.coinBalance / rate) * 60);

    if (maxDurationSeconds < 1) {
      throw new AppError(400, 'Insufficient coins to start call');
    }

    // Update call status to ACTIVE and set calculated times
    call.status = CallStatus.ACTIVE;
    call.startTime = new Date();

    // DEFENSIVE: Ensure startTime was actually set (race condition protection)
    if (!call.startTime) {
      logger.error(
        { callId: String(call._id) },
        '🚨 CRITICAL: startTime is null after assignment - forcing re-assignment'
      );
      call.startTime = new Date(); // Force re-assignment
    }

    call.scheduledEndTime = new Date(call.startTime.getTime() + (maxDurationSeconds * 1000));
    call.maxDurationSeconds = maxDurationSeconds;
    call.initialCoinBalance = user.coinBalance;

    logger.info(
      {
        callId: String(call._id),
        startTime: call.startTime,
        scheduledEndTime: call.scheduledEndTime,
        maxDurationSeconds,
      },
      '✅ Call activated with timing'
    );

    await call.save();

    // Set inCall flag for responder in both User and Responder models
    await User.findByIdAndUpdate(call.responderId, { inCall: true });
    await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: true });

    // Notify both parties that call is now active with max duration AND server start time
    const startTimeMs = call.startTime.getTime();
    emitToUser(call.userId.toString(), 'call_connected', {
      callId: String(call._id),
      maxDuration: maxDurationSeconds,
      startTimeMs, // Server timestamp for synchronization
    });
    emitToUser(call.responderId.toString(), 'call_connected', {
      callId: String(call._id),
      maxDuration: maxDurationSeconds,
      startTimeMs, // Server timestamp for synchronization
    });

    // Schedule automatic call termination
    this.scheduleCallTermination(call);

    logger.info({
      callId: String(call._id),
      maxDurationSeconds,
      scheduledEndTime: call.scheduledEndTime,
      userCoins: user.coinBalance,
    }, 'Call activated with time limit');

    return call;
  },

  // Schedule automatic call termination when time limit is reached
  scheduleCallTermination(call: any) {
    const callId = String(call._id);
    const durationMs = call.maxDurationSeconds! * 1000;

    const timer = setTimeout(async () => {
      try {
        logger.info({ callId }, 'Auto-ending call - time limit reached');

        const currentCall = await Call.findById(callId);
        if (!currentCall || currentCall.status === CallStatus.ENDED) {
          return; // Call already ended
        }

        // End call and deduct coins
        await this.endCallAndDeductCoins(currentCall);

        // Notify both parties
        emitToUser(currentCall.userId.toString(), 'call_ended', {
          callId,
          reason: 'time_limit_reached',
        });
        emitToUser(currentCall.responderId.toString(), 'call_ended', {
          callId,
          reason: 'time_limit_reached',
        });
      } catch (error: any) {
        logger.error({ error: error.message, callId }, 'Failed to auto-end call');
      } finally {
        callTimers.delete(callId);
      }
    }, durationMs);

    callTimers.set(callId, timer);
    logger.info({ callId, durationMs }, 'Call termination scheduled');
  },

  // Calculate actual duration and deduct proportional coins
  async endCallAndDeductCoins(call: any) {
    // DEFENSIVE: Use createdAt as fallback if startTime is missing (race condition safety)
    if (!call.startTime) {
      logger.warn(
        {
          callId: String(call._id),
          status: call.status,
          createdAt: call.createdAt,
        },
        '⚠️ Missing startTime - using createdAt as fallback (likely race condition)'
      );
      // Use createdAt as fallback - ensures duration is always calculated
      call.startTime = call.createdAt;
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - call.startTime.getTime();
    const durationSeconds = Math.floor(durationMs / 1000);

    logger.info(
      {
        callId: String(call._id),
        startTime: call.startTime,
        endTime,
        durationMs,
        durationSeconds,
      },
      '⏱️ Call duration calculated'
    );

    // CRITICAL: Only deduct coins if call was ACTIVE
    // If call was ringing/connecting/cancelled, no coins should be charged
    const wasCallActive = call.status === CallStatus.ACTIVE || call.status === CallStatus.ENDED;

    if (!wasCallActive) {
      logger.info(
        { callId: String(call._id), status: call.status },
        '✅ Call never became active (still ringing/connecting), NO COINS CHARGED'
      );
    } else {
      // Calculate coins to deduct based on actual duration
      const callType = call.type === CallType.AUDIO ? 'audio' : 'video';
      const rate = await coinService.getCallRate(callType);

      // rate is coins per minute, calculate proportional coins for actual duration
      const coinsToDeduct = Math.ceil((durationSeconds / 60) * rate);

      // Deduct coins from user
      const user = await User.findById(call.userId);
      if (user) {
        const actualDeduction = Math.min(coinsToDeduct, user.coinBalance);
        user.coinBalance -= actualDeduction;
        await user.save();

        // Get commission config (cached)
        const responderPercentage = await commissionService.getResponderPercentage();
        const coinToINRRate = await commissionService.getCoinToINRRate();

        // CORRECT CALCULATION ORDER:
        // 1. First convert ALL coins to rupees (total transaction value in rupees)
        // 2. Then apply commission percentage to rupees
        // Example: 10 coins × ₹0.5 = ₹5 total, then 50% commission = ₹2.5 to responder
        const totalRupees = actualDeduction * coinToINRRate;
        // Round to 2 decimal places (paisa precision) instead of whole rupees
        const responderRupees = Math.round(totalRupees * (responderPercentage / 100) * 100) / 100;

        // Calculate coins for logging (reverse calculation)
        const responderCoins = Math.round(actualDeduction * (responderPercentage / 100));

        // Credit responder (NOW IN RUPEES, NOT COINS)
        // CRITICAL: Use atomic update to prevent race conditions when multiple calls end simultaneously
        const responderUpdate = await Responder.findOneAndUpdate(
          { userId: call.responderId },
          {
            $inc: {
              'earnings.totalRupees': responderRupees,
              'earnings.pendingRupees': responderRupees
            }
          },
          {
            new: true,  // Return updated document
            upsert: true,  // Create if doesn't exist
            setDefaultsOnInsert: true,  // Set defaults when creating
          }
        );

        // CRITICAL: Verify that responder earnings were actually updated
        if (!responderUpdate) {
          logger.error({
            callId: String(call._id),
            responderId: call.responderId.toString(),
            responderRupees,
            actualDeduction,
          }, '🚨 CRITICAL: Failed to update responder earnings - payment lost!');
          throw new Error('Failed to credit responder - database update returned null');
        }

        logger.info({
          callId: String(call._id),
          responderId: call.responderId.toString(),
          responderRupees,
          updatedTotalRupees: responderUpdate.earnings.totalRupees,
          updatedPendingRupees: responderUpdate.earnings.pendingRupees,
        }, '✅ Responder earnings updated successfully (atomic operation)');

        // Create transaction record for user
        await Transaction.create([
          {
            userId: call.userId,
            responderId: call.responderId,
            coins: actualDeduction,
            responderEarnings: responderRupees, // Store actual earnings at transaction time
            type: TransactionType.CALL,
            status: TransactionStatus.COMPLETED,
            meta: {
              callId: String(call._id),
              callType: call.type,
              durationSeconds,
              description: `${call.type} call - ${durationSeconds}s`,
            },
          },
        ]);

        call.coinsCharged = actualDeduction;

        logger.info({
          callId: String(call._id),
          durationSeconds,
          coinsDeducted: actualDeduction,
          responderEarnedCoins: responderCoins,
          responderEarnedRupees: responderRupees, // Now logging rupees
          commissionRate: responderPercentage,
          coinToINRRate,
          userBalance: user.coinBalance,
          responderPendingRupees: responderUpdate.earnings.pendingRupees,
        }, 'Coins deducted for call and responder credited in RUPEES');
      }
    }

    // Update call
    call.status = CallStatus.ENDED;
    call.endTime = endTime;
    call.durationSeconds = durationSeconds;
    await call.save();

    // Reset inCall flag for responder in both User and Responder models
    await User.findByIdAndUpdate(call.responderId, { inCall: false });
    await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: false });

    // Create call history message
    await this.createCallMessage(call);
  },

  async handleCallConnectionFailure(callId: string, userId: string, reason: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.userId.toString() !== userId && call.responderId.toString() !== userId) {
      throw new AppError(403, 'Not authorized');
    }

    // Mark call as ended due to connection failure
    call.status = CallStatus.ENDED;
    call.endTime = new Date();
    await call.save();

    // Reset inCall flag for responder (call never truly connected, but safety reset)
    await User.findByIdAndUpdate(call.responderId, { inCall: false });
    await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: false });

    // Notify both parties about connection failure
    emitToUser(call.userId.toString(), 'call_ended', {
      callId: String(call._id),
      reason: 'connection_failed',
    });
    emitToUser(call.responderId.toString(), 'call_ended', {
      callId: String(call._id),
      reason: 'connection_failed',
    });

    logger.warn({ callId, userId, reason }, 'Call connection failed');

    return call;
  },

  async rejectCall(callId: string, responderId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.responderId.toString() !== responderId) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status !== CallStatus.RINGING) {
      throw new AppError(400, 'Call is not in ringing state');
    }

    call.status = CallStatus.REJECTED;
    call.endTime = new Date();
    await call.save();

    // Reset inCall flag for responder if it was set during RINGING
    await User.findByIdAndUpdate(call.responderId, { inCall: false });
    await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: false });

    // Notify caller that call was rejected
    emitToUser(call.userId.toString(), 'call_ended', {
      callId: String(call._id),
      reason: 'rejected',
    });

    // Create call history message for declined call
    await this.createCallMessage(call);

    return call;
  },

  async endCall(callId: string, userId: string) {
    const call = await Call.findById(callId);

    logger.info({
      callId,
      userId,
      callFound: !!call
    }, '🔴 endCall called');

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (
      call.userId.toString() !== userId &&
      call.responderId.toString() !== userId
    ) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status === CallStatus.ENDED) {
      logger.warn({ callId, userId, status: call.status }, '⚠️ Call already ended');
      // Don't throw error, just emit events to ensure both clients are notified
      emitToUser(call.userId.toString(), 'call_ended', {
        callId: String(call._id),
      });
      emitToUser(call.responderId.toString(), 'call_ended', {
        callId: String(call._id),
      });
      return call;
    }

    logger.info({
      callId: String(call._id),
      caller: call.userId.toString(),
      responder: call.responderId.toString(),
      status: call.status,
      endedBy: userId
    }, '📞 Ending call');

    // Cancel scheduled termination if exists
    const timer = callTimers.get(String(call._id));
    if (timer) {
      clearTimeout(timer);
      callTimers.delete(String(call._id));
      logger.info({ callId: String(call._id) }, 'Cancelled scheduled call termination');
    }

    // PERFORMANCE FIX: Emit socket events IMMEDIATELY before any slow operations
    // This ensures the remote party can navigate away instantly
    logger.info({
      callId: String(call._id),
      caller: call.userId.toString(),
      responder: call.responderId.toString()
    }, '📤 Emitting call_ended events IMMEDIATELY to both parties');

    try {
      emitToUser(call.userId.toString(), 'call_ended', {
        callId: String(call._id),
      });
      emitToUser(call.responderId.toString(), 'call_ended', {
        callId: String(call._id),
      });
      logger.info({ callId: String(call._id) }, '✅ Call ended events emitted successfully');
    } catch (error: any) {
      logger.error({ error: error.message, callId: String(call._id) }, '❌ Failed to emit call_ended events');
    }

    // Now do the slow coin deduction in background (non-blocking for the caller)
    // Calculate actual duration and deduct coins
    try {
      await this.endCallAndDeductCoins(call);
    } catch (error: any) {
      logger.error({ error: error.message, callId: String(call._id) }, 'Error in endCallAndDeductCoins');
    }

    logger.info({ callId: String(call._id) }, '✅ Call ended successfully');

    return call;
  },

  async getCallStatus(callId: string) {
    const call = await Call.findById(callId)
      .populate('userId', 'profile phone')
      .populate('responderId', 'userId rating');

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    return call;
  },

  async getCallLogs(userId: string, partnerId: string) {
    // Find all calls between user and partner
    const calls = await Call.find({
      $or: [
        { userId: userId, responderId: partnerId },
        { userId: partnerId, responderId: userId },
      ],
      status: { $in: [CallStatus.ENDED, CallStatus.REJECTED, CallStatus.MISSED] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Format calls with string IDs
    return calls.map(call => ({
      id: String(call._id),
      userId: call.userId.toString(),
      responderId: call.responderId.toString(),
      type: call.type,
      status: call.status,
      startTime: call.startTime,
      endTime: call.endTime,
      durationSeconds: call.durationSeconds,
      coinsCharged: call.coinsCharged,
      createdAt: call.createdAt,
    }));
  },

  async getCallHistory(userId: string) {
    // PERFORMANCE: Use lean() and batch lookup instead of populate
    const calls = await Call.find({
      $or: [
        { userId },
        { responderId: userId },
      ],
      status: { $in: [CallStatus.ENDED, CallStatus.REJECTED, CallStatus.MISSED] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    if (calls.length === 0) {
      return [];
    }

    // PERFORMANCE: Collect all unique user IDs and batch fetch
    const userIdSet = new Set<string>();
    calls.forEach(call => {
      userIdSet.add(call.userId.toString());
      userIdSet.add(call.responderId.toString());
    });

    const users = await User.find({ _id: { $in: Array.from(userIdSet) } })
      .select('profile phone role')
      .lean();

    // Create lookup map
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    logger.info({
      userId,
      callCount: calls.length,
    }, 'Call history retrieved with batch lookup');

    // Fetch transactions to get stored responderEarnings (prevents history changing when commission changes)
    const callIds = calls.map(c => String(c._id));
    const transactions = await Transaction.find({
      'meta.callId': { $in: callIds },
      type: TransactionType.CALL,
    }).lean();

    // Create map: callId -> transaction
    const transactionMap = new Map(
      transactions.map(t => [t.meta?.callId, t])
    );

    // Format calls with user data from map
    // NOTE: Different display for users vs responders:
    // - Users see COINS charged (e.g., 10 coins)
    // - Responders see RUPEES earned (e.g., ₹3 after commission) - FROM STORED TRANSACTION
    return calls.map(call => {
      const userIdStr = call.userId.toString();
      const responderIdStr = call.responderId.toString();

      const userDoc = userMap.get(userIdStr);
      const responderDoc = userMap.get(responderIdStr);

      // Extract user info
      const userName = userDoc?.profile?.name?.trim() || userDoc?.phone || 'User';
      const responderName = responderDoc?.profile?.name?.trim() || responderDoc?.phone || 'Responder';

      // Get display value based on who's viewing
      let displayValue: number;
      if (userId === responderIdStr) {
        // Responder viewing: use STORED earnings from transaction (not dynamically calculated)
        // This ensures historical earnings don't change when commission settings are updated
        const transaction = transactionMap.get(String(call._id));
        displayValue = transaction?.responderEarnings || 0;
      } else {
        // User viewing: show coins charged
        displayValue = call.coinsCharged || 0;
      }

      return {
        id: String(call._id),
        userId: userIdStr,
        responderId: responderIdStr,
        user: {
          id: userIdStr,
          name: userName,
          phone: userDoc?.phone || '',
          avatar: userDoc?.profile?.avatar || null,
        },
        responder: {
          id: responderIdStr,
          name: responderName,
          phone: responderDoc?.phone || '',
          avatar: responderDoc?.profile?.avatar || null,
        },
        type: call.type,
        status: call.status,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.durationSeconds || 0,
        coinsCharged: displayValue, // Coins for users, Rupees for responders (from stored transaction)
        createdAt: call.createdAt,
      };
    });
  },

  async updateCallDuration(callId: string, durationSeconds: number) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    call.durationSeconds = durationSeconds;

    // If call is still active, mark as ended
    if (call.status === CallStatus.ACTIVE) {
      call.status = CallStatus.ENDED;
      call.endTime = new Date();
    }

    await call.save();

    return call;
  },

  generateRoomId(): string {
    return `room_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  },

  // OPTION 2 FIX: Get RINGING calls for a responder
  // DEFENSE: READ-ONLY - doesn't modify any data, just queries
  // Used by client to check for missed calls on app resume
  async getMyRingingCalls(responderId: string) {
    const thirtySecondsAgo = new Date(Date.now() - 30000); // Only recent calls
    
    const calls = await Call.find({
      responderId: responderId,
      status: CallStatus.RINGING,
      createdAt: { $gt: thirtySecondsAgo }, // Only calls within last 30 seconds
    })
    .sort({ createdAt: -1 })
    .limit(1) // Only need the most recent one
    .populate('userId', 'phone profile.name')
    .lean();
    
    // Map to include caller information
    return calls.map(call => ({
      ...call,
      _id: String(call._id),
      callerName: (call.userId as any)?.profile?.name || (call.userId as any)?.phone || 'Unknown',
    }));
  },

  async cleanupStaleCalls() {
    const now = new Date();
    const sixtySecondsAgo = new Date(now.getTime() - 60000);

    // Find old ringing calls to mark as missed
    const ringingCalls = await Call.find({
      status: CallStatus.RINGING,
      createdAt: { $lt: sixtySecondsAgo },
    });

    // Mark old ringing calls as missed and create messages
    for (const call of ringingCalls) {
      call.status = CallStatus.MISSED;
      call.endTime = now;
      await call.save();
      await this.createCallMessage(call);

      // Reset inCall flag for responder
      await User.findByIdAndUpdate(call.responderId, { inCall: false });
      await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: false });
    }

    // 🔥 FIX: Find active calls that exceeded their scheduled end time
    // Don't use startTime - that would end long valid calls!
    const activeCalls = await Call.find({
      status: CallStatus.ACTIVE,
      scheduledEndTime: { $lt: now }, // Use scheduled end time, not start time
    });

    logger.info(
      {
        ringingCallsFound: ringingCalls.length,
        activeCallsFound: activeCalls.length,
      },
      'Cleanup: checking stale calls'
    );

    // Mark calls that exceeded their time limit as ended
    for (const call of activeCalls) {
      logger.warn(
        {
          callId: String(call._id),
          startTime: call.startTime,
          scheduledEndTime: call.scheduledEndTime,
        },
        'Ending call that exceeded scheduled end time'
      );

      call.status = CallStatus.ENDED;
      call.endTime = now;

      // Calculate actual duration for billing
      if (call.startTime) {
        const durationMs = now.getTime() - call.startTime.getTime();
        call.durationSeconds = Math.floor(durationMs / 1000);
      }

      await call.save();

      // Reset inCall flag for responder
      await User.findByIdAndUpdate(call.responderId, { inCall: false });
      await Responder.findOneAndUpdate({ userId: call.responderId }, { inCall: false });
    }

    return {
      ringingCallsCleaned: ringingCalls.length,
      activeCallsCleaned: activeCalls.length,
    };
  },

  generateZegoToken(userId: string, roomId: string): string {
    try {
      const { generateZegoToken, getZegoConfig } = require('../../lib/zegoToken');
      const zegoConfig = getZegoConfig();

      return generateZegoToken({
        appId: zegoConfig.appId,
        serverSecret: zegoConfig.serverSecret,
        userId,
        roomId,
        expireTimeInSeconds: 3600 // 1 hour
      });
    } catch (error) {
      logger.error({ error, userId, roomId }, 'Failed to generate ZEGO token');
      // Return a fallback token for development
      return `dev_token_${userId}_${roomId}_${Date.now()}`;
    }
  },

  async createCallMessage(call: any) {
    try {
      // Find or create chat between user and responder
      let chat = await Chat.findOne({
        participants: { $all: [call.userId, call.responderId] },
      });

      if (!chat) {
        chat = await Chat.create({
          participants: [call.userId, call.responderId],
          lastMessageAt: new Date(),
        });
      }

      // Determine call status for message
      let status: 'completed' | 'missed' | 'declined';
      let content: string;

      if (call.status === CallStatus.ENDED) {
        status = 'completed';
        const duration = call.durationSeconds || 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        content = `${call.type} call ${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;
      } else if (call.status === CallStatus.REJECTED) {
        status = 'declined';
        content = `${call.type} call declined`;
      } else if (call.status === CallStatus.MISSED) {
        status = 'missed';
        content = `Missed ${call.type} call`;
      } else {
        return; // Don't create message for other statuses
      }

      // Create call message
      const message = await Message.create({
        chatId: chat._id,
        senderId: call.userId,
        content,
        type: MessageType.CALL,
        metadata: {
          callType: call.type,
          duration: call.durationSeconds || 0,
          status,
          callId: String(call._id),
        },
        coinsCharged: 0,
      });

      // Update chat's last message time
      chat.lastMessageAt = new Date();
      await chat.save();

      logger.info({ msg: 'Created call history message', callId: String(call._id), messageId: String(message._id) });

      // Emit socket event for new message
      emitToUser(call.userId.toString(), 'new_message', {
        chatId: String(chat._id),
        message: {
          id: String(message._id),
          chatId: String(message.chatId),
          senderId: String(message.senderId),
          content: message.content,
          type: message.type,
          metadata: message.metadata,
          createdAt: message.createdAt,
          readAt: message.readAt,
        },
      });

      emitToUser(call.responderId.toString(), 'new_message', {
        chatId: String(chat._id),
        message: {
          id: String(message._id),
          chatId: String(message.chatId),
          senderId: String(message.senderId),
          content: message.content,
          type: message.type,
          metadata: message.metadata,
          createdAt: message.createdAt,
          readAt: message.readAt,
        },
      });

    } catch (error) {
      logger.error({ msg: 'Failed to create call message', error, callId: String(call._id) });
      // Don't throw - message creation is not critical
    }
  },
};
