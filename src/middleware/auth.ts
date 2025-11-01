import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../models/User';
import { admin } from '../lib/firebase';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    phone: string;
    role: UserRole;
  };
  file?: Express.Multer.File;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    // First, try Firebase ID token
    try {
      const decodedFirebase = await admin.auth().verifyIdToken(token);
      const phone = decodedFirebase.phone_number as string | undefined;
      const uid = decodedFirebase.uid as string;

      let user = null;
      if (phone) {
        user = await User.findOne({ phone });
      } else if (uid) {
        // Admin flow: custom token signs in with uid = Mongo user.id
        user = await User.findById(uid);
      }

      if (user && user.status === 'active') {
        req.user = {
          id: String(user._id),
          phone: user.phone,
          role: user.role,
        };
        return next();
      }
      // If user not found or inactive, fall through to JWT
    } catch (_) {
      // Not a Firebase token; try JWT next
    }

    // Fallback: verify as our JWT (used for admin login)
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret) as {
      id: string;
      phone: string;
      role: UserRole;
    };

    const user = await User.findById(decoded.id);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = decoded;
    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    return next();
  };
};
