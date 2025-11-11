import { Request, Response } from 'express';
import { SupportTicket, TicketStatus } from './support.model';
import { User } from '../../models/User';

// Create support ticket
export const createTicket = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { subject, category, description, priority } = req.body;

    if (!subject || !category || !description) {
      return res.status(400).json({ error: 'Subject, category, and description are required' });
    }

    const ticket = await SupportTicket.create({
      userId,
      subject,
      category,
      description,
      priority: priority || 'medium',
      status: 'open',
    });

    res.status(201).json({ ticket });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'Failed to create support ticket' });
  }
};

// Get user's tickets
export const getUserTickets = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { status, page = 1, limit = 20 } = req.query;

    const query: any = { userId };
    if (status) {
      query.status = status;
    }

    const tickets = await SupportTicket.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await SupportTicket.countDocuments(query);

    res.json({
      tickets,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get user tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
};

// Get ticket details
export const getTicketDetails = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      userId,
    }).populate('userId', 'phone profile.name');

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ ticket });
  } catch (error) {
    console.error('Get ticket details error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket details' });
  }
};

// Add reply to ticket
export const addReply = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      userId,
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    ticket.replies.push({
      userId,
      message,
      isAdmin: false,
      createdAt: new Date(),
    });

    ticket.lastReplyAt = new Date();
    await ticket.save();

    res.json({ ticket });
  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({ error: 'Failed to add reply' });
  }
};

// Admin: Get all tickets
export const getAllTickets = async (req: Request, res: Response) => {
  try {
    const { status, priority, category, page = 1, limit = 20 } = req.query;

    const query: any = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;

    const tickets = await SupportTicket.find(query)
      .populate('userId', 'phone profile.name role')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await SupportTicket.countDocuments(query);

    res.json({
      tickets,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get all tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
};

// Admin: Update ticket status
export const updateTicketStatus = async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;

    if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const ticket = await SupportTicket.findByIdAndUpdate(
      ticketId,
      { status },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ ticket });
  } catch (error) {
    console.error('Update ticket status error:', error);
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
};

// Admin: Add admin reply
export const addAdminReply = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user?.userId;
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    ticket.replies.push({
      userId: adminId,
      message,
      isAdmin: true,
      createdAt: new Date(),
    });

    ticket.lastReplyAt = new Date();
    ticket.status = TicketStatus.IN_PROGRESS;
    await ticket.save();

    res.json({ ticket });
  } catch (error) {
    console.error('Add admin reply error:', error);
    res.status(500).json({ error: 'Failed to add reply' });
  }
};
