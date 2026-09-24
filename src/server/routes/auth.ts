import { Router } from 'express';
import { authenticateDemoUser, demoUsers, issueToken, requireAuth } from '../auth';
import { UnauthorizedError } from '../errors';
import { loginRateLimiter } from '../middleware/security';

const router = Router();

router.post('/auth/login', loginRateLimiter(), (req, res) => {
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const user = authenticateDemoUser(email, password);

  if (!user) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  res.json({ token: issueToken(user), user });
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get('/auth/demo-users', (_req, res) => {
  res.json({
    users: demoUsers.map(({ password, ...user }) => ({
      ...user,
      demoPassword: password,
    })),
  });
});

export default router;
