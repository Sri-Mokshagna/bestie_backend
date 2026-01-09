import { Router } from 'express';
import { paymentController } from './payment.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/authorize';
import { UserRole } from '../../models/User';

const router = Router();

// Public routes
router.post('/webhook', paymentController.handleWebhook);

// Protected routes
router.use(authenticate);

// Get available coin plans
router.get('/plans', paymentController.getPlans);

// Create payment order
router.post('/orders', paymentController.createOrder);

// Get payment status
router.get('/orders/:orderId', paymentController.getPaymentStatus);

// Verify and process payment (manual trigger)
router.post('/orders/:orderId/verify', paymentController.verifyPayment);

// Get payment history
router.get('/history', paymentController.getPaymentHistory);

// Admin only routes
router.post(
  '/orders/:orderId/refund',
  authorize([UserRole.ADMIN]),
  paymentController.refundPayment
);

export default router;
