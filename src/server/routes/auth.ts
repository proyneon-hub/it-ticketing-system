import { Router } from 'express';
import { z } from 'zod';
import asyncHandler from '../asyncHandler';
import { requireAuth } from '../auth';
import { demoUsers } from '../demoUsers';
import { UnauthorizedError } from '../errors';
import { auditContext } from '../http';
import { loginRateLimiter } from '../middleware/security';
import {
  clearRefreshCookie,
  readRefreshCookie,
  requireSameOrigin,
  setRefreshCookie,
} from '../security/cookies';
import { MAX_PASSWORD_LENGTH } from '../security/password';
import { assertAuthConfigured } from '../security/secret';
import { recordAudit } from '../services/auditService';
import { endSession, refreshSession, startSession } from '../services/sessionService';
import { authenticate, ensureDemoUsers, getPublicUser } from '../services/userService';

// The demo accounts' public credentials. Needs no database, so the sign-in page can show
// its one-click buttons even while MongoDB is being configured.
export const demoAccountsRouter = Router();

demoAccountsRouter.get('/auth/demo-users', (_req, res) => {
  res.json({
    users: demoUsers.map(({ password, ...user }, index) => ({
      // Stable placeholders: the real ids belong to database records that may not exist yet.
      id: ['usr_admin', 'usr_tech', 'usr_user'][index],
      ...user,
      demoPassword: password,
    })),
  });
});

const loginBody = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

const router = Router();

router.post(
  '/auth/login',
  loginRateLimiter(),
  asyncHandler(async (req, res) => {
    assertAuthConfigured();
    const context = auditContext(req);
    const body = loginBody.safeParse(req.body);

    await ensureDemoUsers();
    const user = body.success ? await authenticate(body.data.email, body.data.password) : null;

    if (!user) {
      await recordAudit(
        {
          type: 'login_failure',
          outcome: 'failure',
          target: { type: 'user', label: body.success ? body.data.email : undefined },
        },
        context
      );
      throw new UnauthorizedError('Invalid email or password.');
    }

    const session = await startSession(user, context);
    setRefreshCookie(res, session.refreshToken);
    await recordAudit({ type: 'login_success', outcome: 'success', actor: user }, context);

    res.json({ token: session.accessToken, user: session.user });
  })
);

// Trades the refresh cookie for a new access token (and a new cookie). The web app calls
// it on page load to restore a session, and when an access token expires.
router.post(
  '/auth/refresh',
  requireSameOrigin,
  asyncHandler(async (req, res) => {
    assertAuthConfigured();
    const presented = readRefreshCookie(req);
    if (!presented) throw new UnauthorizedError('Not signed in.');

    const context = auditContext(req);
    const outcome = await refreshSession(presented, context);

    if (outcome.kind === 'ok') {
      setRefreshCookie(res, outcome.session.refreshToken);
      res.json({ token: outcome.session.accessToken, user: outcome.session.user });
      return;
    }

    clearRefreshCookie(res);
    if (outcome.kind === 'reuse') {
      const user = await getPublicUser(outcome.userId);
      await recordAudit(
        {
          type: 'refresh_reuse',
          outcome: 'failure',
          actor: user ?? undefined,
          detail:
            'A refresh token that had already been used was presented; the session was ended.',
        },
        context
      );
    }
    throw new UnauthorizedError('Session expired. Sign in again.');
  })
);

router.post(
  '/auth/logout',
  requireSameOrigin,
  asyncHandler(async (req, res) => {
    const presented = readRefreshCookie(req);
    const userId = presented ? await endSession(presented) : undefined;
    clearRefreshCookie(res);

    if (userId) {
      const user = await getPublicUser(userId);
      await recordAudit(
        { type: 'logout', outcome: 'success', actor: user ?? undefined },
        auditContext(req)
      );
    }
    res.status(204).send();
  })
);

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
