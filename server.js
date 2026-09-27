/**
 * AEROSIGHT Disaster Response Platform - Root Entrypoint
 * Allows starting the command dashboard directly from the project root:
 *    node server.js
 */

const path = require('path');

const webDashboardDir = path.join(__dirname, 'web dashboard');

// Switch process directory so static assets and relative paths inside web dashboard resolve correctly
process.chdir(webDashboardDir);

// Launch main server
require(path.join(webDashboardDir, 'server.js'));
