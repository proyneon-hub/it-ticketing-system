const express = require('express');
const { authenticateDemoUser, demoUsers, issueToken, requireAuth } = require('../auth');

const router = express.Router();

router.post('/auth/login', (req, res) => {
  const user = authenticateDemoUser(req.body.email, req.body.password);

  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
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
      demoPassword: password
    }))
  });
});

module.exports = router;
