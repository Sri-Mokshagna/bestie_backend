import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as transactionController from './transaction.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get user's transaction history
router.get('/', transactionController.getTransactions);

export default router;
