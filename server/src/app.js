const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const routes = require('./routes');
const { csrfProtection } = require('./middleware/csrf');
const { apiLimiter, sanitizeBody, flattenQuery } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const openapi = require('./docs/openapi');

const app = express();

// Only trust X-Forwarded-* when explicitly deployed behind a proxy (e.g. "1")
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.disable('x-powered-by');

// API documentation (Swagger UI needs inline styles, so it gets its own relaxed CSP)
app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'AcxiomCRM API' }));
app.get('/api/openapi.json', (req, res) => res.json(openapi));

// Security headers (CSP, HSTS in production, no-sniff, frame-ancestors…)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  hsts: config.isProduction
}));

// HTTPS enforcement in production (behind a TLS-terminating proxy set TRUST_PROXY)
if (config.isProduction && process.env.FORCE_HTTPS !== 'false') {
  app.use((req, res, next) => (req.secure ? next() : res.redirect(301, `https://${req.headers.host}${req.originalUrl}`)));
}

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
if (!config.isTest) {
  // Request logging without bodies/cookies/headers → no credentials in logs
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}


app.use('/api', apiLimiter, flattenQuery, sanitizeBody, csrfProtection, routes);
app.use('/api', notFound);

// Serve the built React client in production (single deployable)
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

module.exports = app;
