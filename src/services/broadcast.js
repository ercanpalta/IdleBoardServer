const media = require('../services/media');
const playlist = require('../services/playlist');
const settings = require('../services/settings');
const state = require('../state');

function getConnectedClientCount() {
    return state.clients.filter(client => !client.isAdmin).length;
}

function broadcastDashboardUpdate() {
    broadcastToAdmins({ tip: 'dashboard_update' });
}

function clearCurrentBroadcast() {
    state.lastBroadcast = { fileName: null, time: 0 };
    broadcastToAll({ tip: 'stream_control', action: 'clear' });
    broadcastDashboardUpdate();
}

function broadcastToAdmins(payload) {
    const chunk = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of state.clients.filter(client => client.isAdmin)) {
        try {
            client.res.write(chunk);
        } catch (err) {}
    }
}

function broadcastToAll(payload) {
    if (state.clients.length === 0) return;
    const chunk = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of state.clients) {
        try {
            c.res.write(chunk);
        } catch (err) {}
    }
}

function broadcastStreamStatus(extra = {}) {
    const activeFile = extra.currentImage !== undefined ? extra.currentImage : state.lastBroadcast.fileName;
    const isVid = activeFile ? media.isVideoFile(activeFile) : false;
    const activeDur = activeFile ? media.getMediaDuration(activeFile) : settings.getSlideIntervalSec();

    const payload = {
        tip: 'stream_status',
        currentImage: activeFile,
        activeDuration: activeDur,
        mediaDuration: activeDur,
        isVideo: isVid,
        slideInterval: settings.getSlideIntervalSec(),
        isPinned: state.isImagePinned,
        isPaused: state.isPlaybackPaused,
        latestBroadcastAt: state.lastBroadcast.time || Date.now(),
        nextMedia: playlist.buildNextMediaPayload(activeFile),
        ...extra
    };

    broadcastToAll(payload);
}

Object.assign(module.exports, {
    broadcastDashboardUpdate,
    broadcastStreamStatus,
    broadcastToAdmins,
    broadcastToAll,
    clearCurrentBroadcast,
    getConnectedClientCount,
});
