import { UserRole } from '../models/User';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        phone: string;
        role: UserRole;
      };
    }
  }
}
