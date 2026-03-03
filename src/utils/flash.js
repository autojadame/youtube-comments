export function flash(req, type, message) {
  if (!req.session) return;
  req.session.flash = { type, message };
}

export function flashMiddleware(req, res, next) {
  res.locals.flash = req.session?.flash || null;
  if (req.session) delete req.session.flash;
  next();
}
