import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 does not forward rejected promises to the error middleware, so async
// route handlers are wrapped to route failures through next().
export default function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
