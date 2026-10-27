const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const activity = require('../services/activity');
const broadcast = require('../services/broadcast');
const slideshow = require('../services/slideshow');
const state = require('../state');

function getServerPort() {
    return state.serverPort;
}

function getSlideIntervalSec() {
    return state.slideIntervalSec;
}

function getKioskIdleTimeoutSec() {
    return state.kioskIdleTimeoutSec;
}

function getImageFitMode() {
    return state.imageFitMode;
}

function getShowInfoBar() {
    return state.showInfoBar;
}

function getShowWatermark() {
    return state.showWatermark;
}

function getWatermarkFileName() {
    return state.watermarkFileName;
}

function getWatermarkFilePath() {
    if (!state.watermarkFileName) return null;
    const p = path.join(cfg.DATA_DIR, state.watermarkFileName);
    return fs.existsSync(p) ? p : null;
}

function getWatermarkBase64() {
    const p = getWatermarkFilePath();
    if (!p) return null;
    try {
        const buf = fs.readFileSync(p);
        return buf.toString('base64');
    } catch (e) {
        return null;
    }
}

function getTransitionEffect() {
    return state.transitionEffect;
}

function getSlideshowOrder() {
    return state.slideshowOrder;
}

function loadServerSettings() {
    if (!fs.existsSync(cfg.SETTINGS_FILE)) return;
    try {
        const stored = JSON.parse(fs.readFileSync(cfg.SETTINGS_FILE, 'utf8'));
        if (typeof stored === 'object' && stored !== null) {
            if (Number.isFinite(stored.slideInterval) && stored.slideInterval >= cfg.MIN_INTERVAL_SEC && stored.slideInterval <= cfg.MAX_INTERVAL_SEC) {
                state.slideIntervalSec = Math.round(stored.slideInterval);
            }
            if (Number.isFinite(stored.kioskIdleTimeout) && stored.kioskIdleTimeout >= cfg.MIN_IDLE_TIMEOUT_SEC && stored.kioskIdleTimeout <= cfg.MAX_IDLE_TIMEOUT_SEC) {
                state.kioskIdleTimeoutSec = Math.round(stored.kioskIdleTimeout);
            }
            if (typeof stored.imageFit === 'string' && cfg.VALID_IMAGE_FITS.has(stored.imageFit)) {
                state.imageFitMode = stored.imageFit;
            }
            if (typeof stored.showInfoBar === 'boolean') {
                state.showInfoBar = stored.showInfoBar;
            }
            if (typeof stored.showWatermark === 'boolean') {
                state.showWatermark = stored.showWatermark;
            }
            if (typeof stored.watermarkFileName === 'string' && stored.watermarkFileName.trim()) {
                const candidate = stored.watermarkFileName.trim();
                if (fs.existsSync(path.join(cfg.DATA_DIR, candidate))) {
                    state.watermarkFileName = candidate;
                }
            } else {
                const defaultCandidates = ['watermark-logo.png', 'watermark-logo.jpg', 'watermark-logo.jpeg', 'watermark-logo.webp'];
                for (const c of defaultCandidates) {
                    if (fs.existsSync(path.join(cfg.DATA_DIR, c))) {
                        state.watermarkFileName = c;
                        break;
                    }
                }
            }
            if (typeof stored.transitionEffect === 'string' && cfg.VALID_TRANSITION_EFFECTS.has(stored.transitionEffect)) {
                state.transitionEffect = stored.transitionEffect;
            }
            if (typeof stored.slideshowOrder === 'string' && cfg.VALID_SLIDESHOW_ORDERS.has(stored.slideshowOrder)) {
                state.slideshowOrder = stored.slideshowOrder;
            }
            if (!process.env.PORT && Number.isInteger(stored.serverPort) && stored.serverPort >= cfg.MIN_PORT && stored.serverPort <= cfg.MAX_PORT) {
                state.serverPort = stored.serverPort;
            }
        }
    } catch (err) {
        console.error('[!] Ayar dosyası okunamadı:', err.message);
    }
}

function saveServerSettings() {
    try {
        const temporaryFile = `${cfg.SETTINGS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify({
            slideInterval: state.slideIntervalSec,
            kioskIdleTimeout: state.kioskIdleTimeoutSec,
            imageFit: state.imageFitMode,
            showInfoBar: state.showInfoBar,
            showWatermark: state.showWatermark,
            watermarkFileName: state.watermarkFileName,
            transitionEffect: state.transitionEffect,
            slideshowOrder: state.slideshowOrder,
            serverPort: state.serverPort
        }, null, 2), { mode: 0o600 });
        fs.renameSync(temporaryFile, cfg.SETTINGS_FILE);
    } catch (err) {
        console.error('[!] Ayarlar kaydedilemedi:', err.message);
    }
}

function setSlideIntervalSec(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < cfg.MIN_INTERVAL_SEC || value > cfg.MAX_INTERVAL_SEC) {
        return false;
    }
    state.slideIntervalSec = Math.round(value);
    saveServerSettings();
    slideshow.restartSlideshowTimer();
    broadcast.broadcastToAll({
        tip: 'config',
        slideInterval: state.slideIntervalSec
    });
    console.log(`[i] Slayt süresi güncellendi: ${state.slideIntervalSec}sn`);
    activity.logActivity('settings', 'Geçiş aralığı güncellendi', `${state.slideIntervalSec} saniye`);
    return true;
}

function setKioskIdleTimeoutSec(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < cfg.MIN_IDLE_TIMEOUT_SEC || value > cfg.MAX_IDLE_TIMEOUT_SEC) {
        return false;
    }
    state.kioskIdleTimeoutSec = Math.round(value);
    saveServerSettings();
    broadcast.broadcastToAll({
        tip: 'config',
        kioskIdleTimeout: state.kioskIdleTimeoutSec
    });
    broadcast.broadcastDashboardUpdate();
    console.log(`[i] Bekleme süresi güncellendi: ${state.kioskIdleTimeoutSec}sn`);
    activity.logActivity('settings', 'Boşta kalma süresi güncellendi', `${seconds} saniye`);
    return true;
}

function setImageFitMode(mode) {
    if (typeof mode !== 'string' || !cfg.VALID_IMAGE_FITS.has(mode)) {
        return false;
    }
    state.imageFitMode = mode;
    saveServerSettings();
    broadcast.broadcastToAll({
        tip: 'config',
        imageFit: state.imageFitMode
    });
    broadcast.broadcastDashboardUpdate();
    console.log(`[i] Görsel yerleşim modu güncellendi: ${state.imageFitMode}`);
    const fitLabels = { uniform: 'Orijinal Boyut', uniformToFill: 'Ekranı Kapla', fill: 'Genişlet' };
    activity.logActivity('settings', 'Görsel yerleşimi güncellendi', fitLabels[state.imageFitMode] || state.imageFitMode);
    return true;
}

function setShowInfoBar(visible) {
    if (typeof visible !== 'boolean') {
        return false;
    }
    state.showInfoBar = visible;
    saveServerSettings();
    broadcast.broadcastToAll({
        tip: 'config',
        showInfoBar: state.showInfoBar
    });
    broadcast.broadcastDashboardUpdate();
    console.log(`[i] Alt bilgi şeridi görünürlüğü güncellendi: ${state.showInfoBar}`);
    activity.logActivity('settings', 'Alt bilgi şeridi güncellendi', state.showInfoBar ? 'Görünür yapıldı' : 'Gizlendi');
    return true;
}

function setTransitionEffect(effect) {
    if (typeof effect !== 'string' || !cfg.VALID_TRANSITION_EFFECTS.has(effect)) {
        return false;
    }
    state.transitionEffect = effect;
    saveServerSettings();
    broadcast.broadcastToAll({
        tip: 'config',
        transitionEffect: state.transitionEffect
    });
    broadcast.broadcastDashboardUpdate();
    console.log(`[i] Geçiş efekti güncellendi: ${state.transitionEffect}`);
    activity.logActivity('settings', 'Geçiş efekti güncellendi', state.transitionEffect === 'none' ? 'Anında geçiş' : 'Yumuşak geçiş (Fade)');
    return true;
}

function setSlideshowOrder(order) {
    if (typeof order !== 'string' || !cfg.VALID_SLIDESHOW_ORDERS.has(order)) {
        return false;
    }
    state.slideshowOrder = order;
    saveServerSettings();
    broadcast.broadcastToAll({
        tip: 'config',
        slideshowOrder: state.slideshowOrder
    });
    broadcast.broadcastDashboardUpdate();
    console.log(`[i] Slayt sıralaması güncellendi: ${state.slideshowOrder}`);
    activity.logActivity('settings', 'Slayt sıralaması güncellendi', state.slideshowOrder === 'random' ? 'Rastgele döngü' : 'Sıralı döngü');
    return true;
}

function setShowWatermark(visible) {
    if (typeof visible !== 'boolean') {
        return false;
    }
    state.showWatermark = visible;
    saveServerSettings();
    broadcast.broadcastToAll({
        tip: 'config',
        showWatermark: state.showWatermark,
        watermarkImage: getWatermarkBase64()
    });
    broadcast.broadcastDashboardUpdate();
    console.log(`[i] Filigran (marka logosu) görünürlüğü güncellendi: ${state.showWatermark}`);
    activity.logActivity('settings', 'Marka logosu filigranı güncellendi', state.showWatermark ? 'Açık' : 'Kapalı');
    return true;
}

Object.assign(module.exports, {
    getImageFitMode,
    getKioskIdleTimeoutSec,
    getServerPort,
    getShowInfoBar,
    getShowWatermark,
    getSlideIntervalSec,
    getSlideshowOrder,
    getTransitionEffect,
    getWatermarkBase64,
    getWatermarkFilePath,
    loadServerSettings,
    saveServerSettings,
    setImageFitMode,
    setKioskIdleTimeoutSec,
    setShowInfoBar,
    setShowWatermark,
    setSlideIntervalSec,
    setSlideshowOrder,
    setTransitionEffect,
});
