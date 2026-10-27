const express = require('express');
const activity = require('../services/activity');
const auth = require('../services/auth');
const broadcast = require('../services/broadcast');
const state = require('../state');

const router = express.Router();

// Aktivite Günlüğü Endpoint'leri
router.get('/api/activity-log', auth.requireAuth, (req, res) => {
    res.json({ activities: state.activityLog.slice(0, 30) });
});

router.post('/api/activity-log/clear', auth.requireAuth, (req, res) => {
    state.activityLog = [{
        id: 'act-' + Date.now(),
        type: 'system',
        title: 'Aktivite geçmişi temizlendi',
        detail: 'Yönetici tarafından sıfırlandı',
        time: Date.now()
    }];
    activity.saveActivityLog();
    broadcast.broadcastDashboardUpdate();
    res.json({ success: true });
});

module.exports = router;
