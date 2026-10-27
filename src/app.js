const express = require('express');
const path = require('path');
const updateManager = require('../updateManager');
const cfg = require('./config');
const state = require('./state');
const { applySecurity } = require('./middleware/security');
const activity = require('./services/activity');
const broadcast = require('./services/broadcast');
const auth = require('./services/auth');

const app = express();

applySecurity(app);
app.use(express.json());

// Statik Web Paneli Dosyaları
app.use(express.static(path.join(cfg.ROOT_DIR, 'public')));
app.use('/images', express.static(cfg.IMAGES_DIR));

app.use(require('./routes/media'));
app.use(require('./routes/events'));
app.use(require('./routes/auth'));
app.use(require('./routes/gallery'));
app.use(require('./routes/stream'));
app.use(require('./routes/settings'));
app.use(require('./routes/activity'));

// GitHub Releases Güncelleme Yöneticisi Rotaları
updateManager.registerUpdateRoutes(app, {
    requireAuth: auth.requireAuth,
    getClients: () => state.clients,
    getConnectedClientCount: broadcast.getConnectedClientCount,
    logActivity: activity.logActivity,
    rootDir: cfg.ROOT_DIR
});

module.exports = { app };
