const fs = require('fs');
const cfg = require('../config');
const broadcast = require('../services/broadcast');
const state = require('../state');

// Aktivite Günlüğü (Activity Log)
const MAX_ACTIVITY_LOG = 40;

function loadActivityLog() {
    if (!fs.existsSync(cfg.ACTIVITY_LOG_FILE)) {
        state.activityLog = [{
            id: 'act-' + Date.now(),
            type: 'system',
            title: 'IdleBoard sunucusu başlatıldı',
            detail: 'Sistem izleme ve yayın servisi devrede',
            time: Date.now()
        }];
        saveActivityLog();
        return;
    }
    try {
        const stored = JSON.parse(fs.readFileSync(cfg.ACTIVITY_LOG_FILE, 'utf8'));
        if (Array.isArray(stored)) {
            state.activityLog = stored.slice(0, MAX_ACTIVITY_LOG);
        }
    } catch (e) {
        console.error('[!] Aktivite günlüğü okunamadı:', e.message);
        state.activityLog = [];
    }
}

function saveActivityLog() {
    try {
        const temporaryFile = `${cfg.ACTIVITY_LOG_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(state.activityLog.slice(0, MAX_ACTIVITY_LOG), null, 2), { mode: 0o600 });
        fs.renameSync(temporaryFile, cfg.ACTIVITY_LOG_FILE);
    } catch (e) {
        console.error('[!] Aktivite günlüğü kaydedilemedi:', e.message);
    }
}

function logActivity(type, title, detail = '') {
    const entry = {
        id: 'act-' + Date.now() + '-' + Math.round(Math.random() * 1000),
        type,
        title,
        detail: typeof detail === 'string' ? detail : (detail ? String(detail) : ''),
        time: Date.now()
    };
    state.activityLog.unshift(entry);
    if (state.activityLog.length > MAX_ACTIVITY_LOG) {
        state.activityLog = state.activityLog.slice(0, MAX_ACTIVITY_LOG);
    }
    saveActivityLog();
    broadcast.broadcastDashboardUpdate();
}

Object.assign(module.exports, {
    loadActivityLog,
    logActivity,
    saveActivityLog,
});
