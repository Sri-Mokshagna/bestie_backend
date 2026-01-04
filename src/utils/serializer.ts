import { Types } from 'mongoose';

/**
 * Utility functions for consistent ID serialization across the application
 * Fixes MongoDB ObjectId to string conversion issues
 */

/**
 * Convert MongoDB ObjectId or string to string
 */
export function toStringId(id: any): string {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (id instanceof Types.ObjectId) return id.toString();
  if (id._id) return toStringId(id._id);
  return String(id);
}

/**
 * Convert string to MongoDB ObjectId
 */
export function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(id);
}

/**
 * Check if string is valid MongoDB ObjectId
 */
export function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

/**
 * Serialize user object for API response
 */
export function serializeUser(user: any) {
  if (!user) return null;
  
  return {
    id: toStringId(user._id),
    phone: user.phone,
    role: user.role,
    coinBalance: user.coinBalance || 0,
    profile: {
      name: user.profile?.name || null,
      email: user.profile?.email || null,
      bio: user.profile?.bio || null,
      avatar: user.profile?.avatar || null,
      gender: user.profile?.gender || null,
      language: user.profile?.language || null,
      voiceText: user.profile?.voiceText || null,
      voiceBlob: user.profile?.voiceBlob || null,
    },
    status: user.status,
    isOnline: user.isOnline || false,
    isAvailable: user.isAvailable || true,
    lastOnlineAt: user.lastOnlineAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Serialize responder object for API response
 */
export function serializeResponder(responder: any, user: any) {
  return {
    id: toStringId(responder._id),
    userId: toStringId(responder.userId),
    user: serializeUser(user),
    responder: {
      id: toStringId(responder._id),
      bio: responder.bio || user?.profile?.bio || null,
      rating: responder.rating || 0,
      totalCalls: responder.totalCalls || 0,
      isOnline: user?.isOnline || false,
      isAvailable: user?.isAvailable || true,
      earnings: {
        totalCoins: responder.earnings?.totalCoins || 0,
        pendingCoins: responder.earnings?.pendingCoins || 0,
        redeemedCoins: responder.earnings?.redeemedCoins || 0,
      },
    },
  };
}

/**
 * Serialize chat object for API response
 */
export function serializeChat(chat: any) {
  return {
    id: toStringId(chat._id),
    participants: chat.participants?.map(toStringId) || [],
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

/**
 * Serialize message object for API response
 */
export function serializeMessage(message: any) {
  return {
    id: toStringId(message._id),
    chatId: toStringId(message.chatId),
    senderId: toStringId(message.senderId),
    content: message.content,
    coinsCharged: message.coinsCharged || 0,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

/**
 * Serialize call object for API response
 */
export function serializeCall(call: any) {
  return {
    id: toStringId(call._id),
    userId: toStringId(call.userId),
    responderId: toStringId(call.responderId),
    type: call.type,
    status: call.status,
    roomId: call.roomId,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    duration: call.duration,
    coinsCharged: call.coinsCharged || 0,
    liveMeter: call.liveMeter ? {
      lastTickAt: call.liveMeter.lastTickAt,
      tickCount: call.liveMeter.tickCount,
      totalCoinsDeducted: call.liveMeter.totalCoinsDeducted,
    } : null,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
  };
}

/**
 * Serialize transaction object for API response
 */
export function serializeTransaction(transaction: any) {
  return {
    id: toStringId(transaction._id),
    userId: toStringId(transaction.userId),
    responderId: transaction.responderId ? toStringId(transaction.responderId) : null,
    type: transaction.type,
    coins: transaction.coins,
    status: transaction.status,
    meta: transaction.meta || {},
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

/**
 * Serialize payout object for API response
 */
export function serializePayout(payout: any) {
  return {
    id: toStringId(payout._id),
    responderId: toStringId(payout.responderId),
    coins: payout.coins,
    amountINR: payout.amountINR,
    status: payout.status,
    gatewayResponse: payout.gatewayResponse || null,
    createdAt: payout.createdAt,
    updatedAt: payout.updatedAt,
  };
}

/**
 * Serialize coin plan object for API response
 */
export function serializeCoinPlan(plan: any) {
  return {
    id: toStringId(plan._id),
    name: plan.name,
    coins: plan.coins,
    priceINR: plan.priceINR,
    discount: plan.discount || 0,
    isActive: plan.isActive,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

/**
 * Serialize array of documents
 */
export function serializeArray<T>(
  items: any[],
  serializer: (item: any) => T
): T[] {
  return items.map(serializer);
}

/**
 * Serialize paginated response
 */
export function serializePaginated<T>(
  items: any[],
  serializer: (item: any) => T,
  page: number,
  limit: number,
  total: number
) {
  return {
    data: serializeArray(items, serializer),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
}
