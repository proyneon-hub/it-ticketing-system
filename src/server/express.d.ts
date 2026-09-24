import type { TokenPayload } from './auth';

// Adds what our middleware attaches to every request. requireAuth sets `user`.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export {};
