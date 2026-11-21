const authService = require('../services/authService');
const { issueToken } = require('../middleware/csrf');
const { toSessionDTO } = require('../dtos');

exports.csrf = (req, res) => {
  const token = issueToken(res);
  res.json({ success: true, data: { csrfToken: token } });
};

exports.register = async (req, res) => {
  const user = await authService.register(req.body, req);
  authService.setSessionCookie(res, user);
  res.status(201).json({ success: true, message: 'Registration successful.', data: toSessionDTO(user) });
};

exports.login = async (req, res) => {
  const user = await authService.login(req.body.login, req.body.password, req);
  authService.setSessionCookie(res, user);
  res.json({ success: true, message: 'Login successful.', data: toSessionDTO(user) });
};

/**
 * For non-browser API clients (Postman, integrations): same credential checks,
 * lockout and auditing as /login, but returns a short-lived Bearer token
 * instead of setting a cookie.
 */
exports.token = async (req, res) => {
  const user = await authService.login(req.body.login, req.body.password, req);
  const { token, exp } = authService.signToken(user);
  res.json({ success: true, data: { tokenType: 'Bearer', accessToken: token, expiresAt: new Date(exp * 1000), user: toSessionDTO(user) } });
};

exports.logout = async (req, res) => {
  await authService.logout(req);
  authService.clearSession(res);
  res.json({ success: true, message: 'You have been signed out.' });
};

exports.me = (req, res) => res.json({ success: true, data: toSessionDTO(req.user) });

exports.changePassword = async (req, res) => {
  const user = await authService.changePassword(req.user._id, req.body, req);
  await user.populate('role');
  if (req.auth.viaCookie) authService.setSessionCookie(res, user); // re-issue session (old sessions invalidated)
  res.json({ success: true, message: 'Password changed successfully.', data: toSessionDTO(user) });
};

