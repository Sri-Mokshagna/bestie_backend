import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export class AppError extends Error {
  public code?: string;
  
  constructor(
    public statusCode: number,
    public message: string,
    codeOrOperational?: string | boolean
  ) {
    super(message);
    
    // Handle both old signature (boolean) and new signature (string code)
    if (typeof codeOrOperational === 'string') {
      this.code = codeOrOperational;
    }
    
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    logger.error({
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
      path: req.path,
      method: req.method,
    });

    const response: any = {
      error: err.message,
    };
    
    if (err.code) {
      response.code = err.code;
    }

    return res.status(err.statusCode).json(response);
  }

  // Unhandled errors
  logger.error({
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    error: 'Internal server error',
  });
};

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
  });
};
