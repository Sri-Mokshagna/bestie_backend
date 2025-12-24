import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import { Chat, Message } from '../../models/Chat';
import { User } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';

export const chatController = {
  async getChats(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const userId = req.user.id;
    // Convert to ObjectId for aggregation query
    const userObjectId = new Types.ObjectId(userId);

    // PERFORMANCE FIX: Use aggregation to get chats with last message in ONE query
    const chatsWithMessages = await Chat.aggregate([
      { $match: { participants: userObjectId } },
      { $sort: { lastMessageAt: -1 } },
      // Lookup last message for each chat
      {
        $lookup: {
          from: 'messages',
          let: { chatId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$chatId', '$$chatId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: 'lastMessageArr'
        }
      },
      // Add lastMessage field
      {
        $addFields: {
          lastMessage: { $arrayElemAt: ['$lastMessageArr', 0] }
        }
      },
      { $project: { lastMessageArr: 0 } }
    ]);

    // Get all partner IDs in one go
    const partnerIds = chatsWithMessages.map((chat: any) => {
      const partnerId = chat.participants.find(
        (p: any) => p.toString() !== userId.toString()
      );
      return partnerId;
    }).filter(Boolean);

    // PERFORMANCE FIX: Batch fetch all partners in ONE query
    const partners = await User.find({ _id: { $in: partnerIds } })
      .select('profile phone isOnline')
      .lean();

    // Create a map for quick lookup
    const partnerMap = new Map(partners.map(p => [p._id.toString(), p]));

    // Format response
    const chatsWithPartners = chatsWithMessages.map((chat: any) => {
      const partnerIdObj = chat.participants.find(
        (p: any) => p.toString() !== userId.toString()
      );
      const partnerId = partnerIdObj?.toString();
      const partner = partnerId ? partnerMap.get(partnerId) : null;
      const lastMessage = chat.lastMessage;

      return {
        chat: {
          id: chat._id,
          participants: chat.participants.map((p: any) => p.toString()),
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          lastMessage: lastMessage ? {
            id: lastMessage._id.toString(),
            chatId: lastMessage.chatId.toString(),
            senderId: lastMessage.senderId.toString(),
            content: lastMessage.content,
            type: lastMessage.type || 'text',
            metadata: lastMessage.metadata || null,
            createdAt: lastMessage.createdAt,
            readAt: lastMessage.readAt,
          } : null,
        },
        partnerId: partnerId || '',
        partnerName: partner?.profile?.name || partner?.phone || 'User',
        partnerAvatar: partner?.profile?.avatar || null,
        isOnline: partner?.isOnline || false,
      };
    });

    res.json({ chats: chatsWithPartners });
  },

  async getMessages(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { roomId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    // Verify user is participant
    const chat = await Chat.findById(roomId);
    if (!chat) {
      throw new AppError(404, 'Chat not found');
    }

    const isParticipant = chat.participants.some(
      (p) => p.toString() === req.user!.id
    );

    if (!isParticipant) {
      throw new AppError(403, 'Not authorized');
    }

    // Get messages
    const messages = await Message.find({ chatId: roomId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Message.countDocuments({ chatId: roomId });

    // Format messages with string IDs
    const formattedMessages = messages.map((msg: any) => ({
      id: msg._id.toString(),
      chatId: msg.chatId.toString(),
      senderId: msg.senderId.toString(),
      content: msg.content,
      type: msg.type || 'text',
      metadata: msg.metadata || null,
      createdAt: msg.createdAt,
      readAt: msg.readAt,
    }));

    res.json({
      messages: formattedMessages.reverse(),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  },

  async createChat(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { participantId } = req.body;

    if (!participantId) {
      throw new AppError(400, 'Participant ID is required');
    }

    // Convert to ObjectIds for proper MongoDB comparison
    const userObjectId = new Types.ObjectId(req.user.id);
    const participantObjectId = new Types.ObjectId(participantId);

    // Check if chat already exists
    const existingChat = await Chat.findOne({
      participants: { $all: [userObjectId, participantObjectId] },
    });

    if (existingChat) {
      return res.json({ chat: existingChat });
    }

    // Create new chat
    const chat = await Chat.create({
      participants: [userObjectId, participantObjectId],
    });

    return res.json({ chat });
  },

  async sendMessage(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { chatId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      throw new AppError(400, 'Message content is required');
    }

    // Verify user is participant in the chat
    const chat = await Chat.findById(chatId);
    if (!chat) {
      throw new AppError(404, 'Chat not found');
    }

    const isParticipant = chat.participants.some(
      (p) => p.toString() === req.user!.id
    );

    if (!isParticipant) {
      throw new AppError(403, 'Not authorized to send messages in this chat');
    }

    // Create the message
    const message = await Message.create({
      chatId: new Types.ObjectId(chatId),
      senderId: new Types.ObjectId(req.user.id),
      content: content.trim(),
      coinsCharged: 0, // TODO: Implement coin charging logic
    });

    // Update chat's lastMessageAt
    await Chat.findByIdAndUpdate(chatId, {
      lastMessageAt: new Date(),
    });

    // Get the created message
    const createdMessage = await Message.findById(message._id).lean();

    res.json({
      message: {
        id: createdMessage!._id.toString(),
        chatId: createdMessage!.chatId.toString(),
        senderId: createdMessage!.senderId.toString(),
        content: createdMessage!.content,
        createdAt: createdMessage!.createdAt,
        readAt: createdMessage!.readAt,
      },
    });
  },
};
