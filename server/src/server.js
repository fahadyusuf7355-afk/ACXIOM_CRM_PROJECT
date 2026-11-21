const config = require('./config');
const { connectDB } = require('./config/db');
const { ensureRoles } = require('./seed/roles');
const app = require('./app');

(async () => {
  try {
    await connectDB();
    await ensureRoles();
    app.listen(config.port, () => {
      console.log(`AcxiomCRM API listening on http://localhost:${config.port} (${config.env})`);
      console.log(`API docs: http://localhost:${config.port}/api/docs`);
    });
  } catch (e) {
    console.error('Failed to start server:', e.message);
    process.exit(1);
  }
})();
