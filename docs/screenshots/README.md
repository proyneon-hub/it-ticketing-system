# Screenshots

Images used by the README.

| File                                                                                                                        | How it is made                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin-dashboard.png`, `ticket-create-form.png`, `ticket-update-flow.png`, `technician-dashboard.png`, `user-dashboard.png` | `npm run screenshots:portfolio` runs `tests/visual/capture-portfolio-screenshots.spec.ts` in Chromium against the mocked API, so the output is deterministic. Copy the files from Playwright's `test-results` folder into this one |
| `api-docs.png`                                                                                                              | The interactive API docs at `/api/docs`, captured from the production build                                                                                                                                                        |

Regenerate them after any visible UI change.
