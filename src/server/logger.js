const { randomUUID } = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const logger = pino({
  // Tests stay quiet unless LOG_LEVEL is set explicitly.
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'it-ticketing-system' },
});

// A caller (a load balancer, or a support engineer reproducing a problem) may
// supply x-request-id. Only well-formed values are trusted, which stops log injection.
const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

function resolveRequestId(req, res) {
  const supplied = req.headers['x-request-id'];
  const id =
    typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

// One structured log line per request, tagged with the request id that is also
// returned to the client. That id is what links a user's error report to the logs.
const requestLogger = pinoHttp({
  logger,
  genReqId: resolveRequestId,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Log only what is needed to trace a request. Headers, which carry bearer
  // tokens, are never serialized.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

module.exports = { logger, requestLogger };
