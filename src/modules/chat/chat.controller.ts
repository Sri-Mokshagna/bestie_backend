import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { Chat, Message } from '../../models/Chat';
import { User } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';

export const chatController = {
  async getChats(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const chats = await Chat.find({
      participants: req.user.id,
    })
      .sort({ lastMessageAt: -1 })
      .lean();

    // Get last message for each chat and format with partner info
    const chatsWithPartners = await Promise.all(
      chats.map(async (chat) => {
        const lastMessage = await Message.findOne({ chatId: chat._id })
          .sort({ createdAt: -1 })
          .lean();

        // Find the chat partner (the other participant)
        // participants is an array of ObjectIds at this point (not populated)
        const partnerIdObj = chat.participants.find(
          (p: any) => p.toString() !== req.user!.id.toString()
        );

        if (!partnerIdObj) {
          throw new AppError(500, 'Invalid chat participants');
        }

        const partnerId = partnerIdObj.toString();
        const partner = await User.findById(partnerId).select('profile phone isOnline').lean();

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
              createdAt: lastMessage.createdAt,
              readAt: lastMessage.readAt,
            } : null,
          },
          partnerId: partnerId,
          partnerName: partner?.profile?.name || partner?.phone || 'User',
          partnerAvatar: partner?.profile?.avatar || null,
          isOnline: partner?.isOnline || false,
        };
      })
    );

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
    const formattedMessages = messages.map(msg => ({
      id: msg._id.toString(),
      chatId: msg.chatId.toString(),
      senderId: msg.senderId.toString(),
      content: msg.content,
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

    // Check if chat already exists
    const existingChat = await Chat.findOne({
      participants: { $all: [req.user.id, participantId] },
    });

    if (existingChat) {
      return res.json({ chat: existingChat });
    }

    // Create new chat
    const chat = await Chat.create({
      participants: [req.user.id, participantId],
    });

    res.json({ chat });
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
      chatId: chatId,
      senderId: req.user.id,
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
