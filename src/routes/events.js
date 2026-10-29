const express = require('express');
const crypto = require('crypto');
const updateManager = require('../../updateManager');
const security = require('../middleware/security');
const activity = require('../services/activity');
const auth = require('../services/auth');
const broadcast = require('../services/broadcast');
const media = require('../services/media');
const playlist = require('../services/playlist');
const settings = require('../services/settings');
const slideshow = require('../services/slideshow');
const state = require('../state');

const router = express.Router();

// SSE Endpoint (C# WPF İstemcisinin ve Web Panelinin Bağlandığı Adres)
const MAX_SSE_CLIENTS_PER_IP = Number(process.env.MAX_SSE_CLIENTS_PER_IP) || 50;
const MAX_SSE_CLIENTS_TOTAL = Number(process.env.MAX_SSE_CLIENTS_TOTAL) || 500;

// IPv4-mapped IPv6 adresleri sadeleştirilir; gerçek IPv6 adresleri tam korunur (son hextet'e indirgenmez)
function normalizeRemoteIp(addr) {
    return String(addr || '').replace(/^::ffff:/i, '');
}

// Genel sürüm bilgisi yalnızca yerel ağdaki ekranlardan kabul edilir; dışarıdan sahte sürüm bildirimi güncellemeleri gizleyemez
function isLanAddress(ip) {
    return ip === '::1'
        || /^(127|10)\./.test(ip)
        || /^192\.168\./.test(ip)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
        || /^169\.254\./.test(ip)
        || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
        || /^f[cd][0-9a-f]{2}:/i.test(ip)
        || /^fe80:/i.test(ip);
}

router.get('/events', (req, res) => {
    const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
    const fromSameIp = state.clients.filter((c) => !c.isAdmin && c.clientIp === remoteIp).length;
    const totalDisplays = state.clients.filter((c) => !c.isAdmin).length;
    if (totalDisplays >= MAX_SSE_CLIENTS_TOTAL || fromSameIp >= MAX_SSE_CLIENTS_PER_IP) {
        res.setHeader('Retry-After', '10');
        return res.status(429).end();
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }
    if (req.socket) {
        req.socket.setKeepAlive(true, 5000);
        req.socket.setNoDelay(true);
    }

    const origin = req.headers.origin;
    if (origin && security.isAllowedOrigin(origin, req)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const clientId = crypto.randomUUID();
    const token = auth.getRequestAuthToken(req);
    const isAdmin = req.query.source === 'admin' && Boolean(auth.isTokenValid(token));
    const clientIp = remoteIp;
    const rawVersion = typeof req.query.clientVersion === 'string' ? req.query.clientVersion.trim() : '';
    const clientVersion = /^\d+(\.\d+){0,3}$/.test(rawVersion) ? rawVersion : null;
    if (clientVersion && !isAdmin && isLanAddress(remoteIp)) {
        updateManager.setLastKnownClientVersion(clientVersion);
    }
    const newClient = { id: clientId, res, isAdmin, clientVersion, clientIp, connectedAt: Date.now() };
    state.clients.push(newClient);

    if (!isAdmin) {
        broadcast.broadcastToAdmins({ tip: 'client_count', connectedClients: broadcast.getConnectedClientCount() });
        activity.logActivity('client_connect', 'Ekran istemcisi bağlandı', clientIp ? `IP: ${clientIp}` : 'Yeni ekran bağlantısı');
    }
    console.log(`[+] Yeni istemci bağlandı. (ID: ${clientId}, Toplam: ${broadcast.getConnectedClientCount()})`);

    const activeSelectedList = playlist.getActiveSelectedImages();
    const curFile = state.lastBroadcast.fileName || (activeSelectedList.length > 0 ? activeSelectedList[0] : null);
    const isVid = curFile ? media.isVideoFile(curFile) : false;
    const activeDur = curFile ? media.getMediaDuration(curFile) : settings.getSlideIntervalSec();

    res.write('data: ' + JSON.stringify({
        tip: 'init',
        mesaj: 'Bağlantı Başarılı',
        slideInterval: settings.getSlideIntervalSec(),
        imageFit: settings.getImageFitMode(),
        showInfoBar: settings.getShowInfoBar(),
        transitionEffect: settings.getTransitionEffect(),
        slideshowOrder: settings.getSlideshowOrder(),
        showWatermark: settings.getShowWatermark(),
        watermarkImage: settings.getWatermarkBase64(),
        activeImages: activeSelectedList,
        isPaused: state.isPlaybackPaused,
        isPinned: state.isImagePinned,
        currentImage: curFile,
        isVideo: isVid,
        activeDuration: activeDur,
        mediaDuration: activeDur,
        broadcastAt: state.lastBroadcast.time || Date.now(),
        serverNow: Date.now()
    }) + '\n\n');

    if (state.isPlaybackPaused && !isAdmin) {
        res.write('data: ' + JSON.stringify({
            tip: 'stream_control',
            action: 'stop'
        }) + '\n\n');
    } else if (!state.isPlaybackPaused) {
        // Yeni bağlanan istemciye anlık yayındaki aktif görseli hemen ulaştır
        slideshow.sendCurrentBroadcastToClient(newClient);
        // Slayt zamanlayıcısı henüz devrede değilse ve sabitlenmemişse başlat
        if (!state.slideshowTimer && !state.isImagePinned) {
            slideshow.restartSlideshowTimer();
        }
    }
    if (!isAdmin && playlist.getActiveSelectedImages().length === 0) {
        res.write(`data: ${JSON.stringify({
            tip: 'stream_control',
            action: 'clear'
        })}\n\n`);
    }

    req.on('close', () => {
        state.clients = state.clients.filter(c => c.id !== clientId);
        if (!isAdmin) {
            broadcast.broadcastToAdmins({ tip: 'client_count', connectedClients: broadcast.getConnectedClientCount() });
            activity.logActivity('client_disconnect', 'Ekran istemcisi ayrıldı', clientIp ? `IP: ${clientIp}` : 'Ekran bağlantısı sonlandı');
        }
        console.log(`[-] İstemci ayrıldı. (ID: ${clientId}, Kalan: ${broadcast.getConnectedClientCount()})`);
    });
});

// SSE Canlı Bağlantı Kalp Atışı (Keep-Alive / Heartbeat) Zamanlayıcısı (Her 15 saniyede bir)
setInterval(() => {
    if (state.clients.length === 0) return;
    const heartbeatComment = ': keep-alive\n\n';
    for (const client of state.clients) {
        try {
            client.res.write(heartbeatComment);
        } catch (err) {}
    }
}, 5000);

module.exports = router;
