import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { actorOf, auditContext } from '../http';
import { recordAudit } from '../services/auditService';
import { changeRole, listUsers } from '../services/userService';
import { parsePatchUser } from '../validation/users';

// Administration: who has which role. Admins only.
const router = Router();

router.use('/users', requireAuth, requireRole('admin'));

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    res.json({ users: await listUsers() });
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { role } = parsePatchUser(req.body);
    const { user, previousRole } = await changeRole(String(req.params.id), role);

    await recordAudit(
      {
        type: 'role_changed',
        outcome: 'success',
        actor: actorOf(req),
        target: { type: 'user', id: user.id, label: user.email },
        detail: `Role changed from ${previousRole} to ${role}.`,
      },
      auditContext(req)
    );

    res.json({ user });
  })
);

export default router;
