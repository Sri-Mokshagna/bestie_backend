import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as supportController from './support.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// User routes
router.post('/tickets', supportController.createTicket);
router.get('/tickets', supportController.getUserTickets);
router.get('/tickets/:ticketId', supportController.getTicketDetails);
router.post('/tickets/:ticketId/reply', supportController.addReply);

// Admin routes
router.get('/admin/tickets', authorize(UserRole.ADMIN), supportController.getAllTickets);
router.put('/admin/tickets/:ticketId/status', authorize(UserRole.ADMIN), supportController.updateTicketStatus);
router.post('/admin/tickets/:ticketId/reply', authorize(UserRole.ADMIN), supportController.addAdminReply);

export default router;
