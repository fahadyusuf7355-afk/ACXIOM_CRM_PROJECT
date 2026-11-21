/**
 * Central configuration (Cross-Cutting: configuration management).
 * Every value is read from environment variables so that secrets such as the
 * database URI and JWT secret are never hard-coded in source control.
 */
require('dotenv').config({ quiet: true });

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  port: int(process.env.PORT, 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/acxiomcrm',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    cookieName: 'acx_session'
  },
  csrf: {
    secret: process.env.CSRF_SECRET || process.env.JWT_SECRET,
    cookieName: 'XSRF-TOKEN',
    headerName: 'x-xsrf-token'
  },

  // Password policy (section 6.2) – configurable
  passwordPolicy: {
    minLength: int(process.env.PASSWORD_MIN_LENGTH, 8),
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireDigit: true,
    requireSpecial: true,
    historyCount: int(process.env.PASSWORD_HISTORY_COUNT, 3),
    bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12)
  },

  // Lockout policy (section 6.3) – configurable
  lockout: {
    maxFailedAttempts: int(process.env.LOCKOUT_MAX_ATTEMPTS, 5),
    durationMinutes: int(process.env.LOCKOUT_MINUTES, 15)
  },

  rateLimit: {
    authWindowMinutes: int(process.env.AUTH_RATE_WINDOW_MIN, 15),
    authMax: int(process.env.AUTH_RATE_MAX, 50)
  },

  // Validation limits shared with the client (section 5)
  limits: {
    nameMax: 100,
    companyMax: 150,
    emailMax: 254,
    addressMax: 250,
    cityMax: 60,
    notesMax: 2000,
    subjectMax: 150,
    leadExpectedValueMax: 1000000000, // ₹100 crore
    opportunityAmountMax: 10000000000
  },
  phonePattern: /^[6-9]\d{9}$/ // 10-digit Indian mobile number
};

if (!config.jwt.secret) {
  if (config.isProduction) {
    throw new Error('JWT_SECRET must be set in production');
  }
  // Development/test fallback only – never used in production.
  config.jwt.secret = 'dev-only-insecure-secret-change-me';
  config.csrf.secret = config.csrf.secret || config.jwt.secret;
}

module.exports = config;
