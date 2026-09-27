# Screenshots

Images used by the README.

| File                                                                                                                        | How it is made                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin-dashboard.png`, `ticket-create-form.png`, `ticket-update-flow.png`, `technician-dashboard.png`, `user-dashboard.png` | `npm run screenshots:portfolio` runs `tests/visual/capture-portfolio-screenshots.spec.ts` in Chromium against the mocked API, so the output is deterministic. Copy the files from Playwright's `test-results` folder into this one |
| `agent-proposal.png`, `agent-admin.png`                                                                                     | The same `npm run screenshots:portfolio` run (its second test), using the mocked agent API in `tests/e2e-mocked/agentSupport.ts`: the reply the agent drafted for a technician, and the admin page that runs it                    |
| `api-docs.png`                                                                                                              | The interactive API docs at `/api/docs`, captured from the production build (see below)                                                                                                                                            |

Regenerate them after any visible UI change.

## The animated demo

`demo.gif` is built from six screenshots taken by a Playwright script against the mocked API (a person creates a ticket, assigns it, works it to resolved, and opens it to read its history), so it is deterministic and needs no screen recorder.

```bash
npm run screenshots:demo                          # writes frame-*.png under test-results/
pip install pillow
python scripts/make-demo-gif.py test-results      # writes docs/screenshots/demo.gif
```

`trends.png` and `ticket-comments.png` come from `npm run screenshots:portfolio` like the dashboards.

## The API docs screenshot

`api-docs.png` is the top of `/api/docs` from a real production build, not the mocked API, so it needs a throwaway database rather than a mock:

```bash
npm run build
npm run dev:db                             # terminal 1: a throwaway in-memory MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/it_ticketing PORT=5099 NODE_ENV=production \
  AUTH_SECRET=local-screenshot-demo-secret-do-not-reuse-32ch \
  node --enable-source-maps dist-server/server.js   # terminal 2
npx playwright screenshot --viewport-size=1280,1000 --wait-for-timeout=1200 \
  http://127.0.0.1:5099/api/docs docs/screenshots/api-docs.png
```
