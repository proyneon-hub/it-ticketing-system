// Express 4 does not forward rejected promises to the error middleware, so async
// route handlers are wrapped to route failures through next().
module.exports = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
