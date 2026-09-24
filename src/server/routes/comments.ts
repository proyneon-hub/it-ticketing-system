import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { requireAuth } from '../auth';
import { actorOf as actor } from '../http';
import * as comments from '../services/commentService';
import { parseCreateComment } from '../validation/tickets';

const router = Router();

router.use('/tickets/:id/comments', requireAuth);

router.get(
  '/tickets/:id/comments',
  asyncHandler(async (req, res) => {
    res.json({ comments: await comments.listComments(actor(req), String(req.params.id)) });
  })
);

router.post(
  '/tickets/:id/comments',
  asyncHandler(async (req, res) => {
    const comment = await comments.addComment(
      actor(req),
      String(req.params.id),
      parseCreateComment(req.body)
    );
    res.status(201).json({ comment });
  })
);

export default router;
