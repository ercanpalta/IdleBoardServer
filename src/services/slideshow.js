const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const broadcast = require('../services/broadcast');
const media = require('../services/media');
const playlist = require('../services/playlist');
const settings = require('../services/settings');
const state = require('../state');

function sendCurrentBroadcastToClient(client) {
    if (state.isPlaybackPaused) return;
    const currentFile = state.lastBroadcast.fileName || (state.selectedImageFiles.size > 0 ? [...state.selectedImageFiles][0] : null);
    if (!currentFile) return;

    const filePath = path.join(cfg.IMAGES_DIR, currentFile);
    if (!fs.existsSync(filePath)) return;

    const isVid = media.isVideoFile(currentFile);
    const mediaDuration = media.getMediaDuration(currentFile);
    const nextMedia = playlist.buildNextMediaPayload(currentFile);

    const payload = {
        tip: 'image',
        mediaType: isVid ? 'video' : 'image',
        dosyaAdi: currentFile,
        mediaUrl: isVid ? '/images/' + encodeURIComponent(currentFile) : undefined,
        videoDuration: isVid ? mediaDuration : undefined,
        zaman: new Date().toLocaleTimeString(),
        slideInterval: isVid ? mediaDuration : settings.getSlideIntervalSec(),
        imageFit: settings.getImageFitMode(),
        showInfoBar: settings.getShowInfoBar(),
        transitionEffect: settings.getTransitionEffect(),
        slideshowOrder: settings.getSlideshowOrder(),
        showWatermark: settings.getShowWatermark(),
        activeImages: playlist.getActiveSelectedImages(),
        broadcastAt: state.lastBroadcast.time || Date.now(),
        serverNow: Date.now(),
        nextMedia: nextMedia,
        isPinned: state.isImagePinned
    };

    payload.resimData = null;
    try {
        client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {}
}

function slideshowTick() {
    if (state.isPlaybackPaused || state.isImagePinned || state.slideshowTickInFlight) return;

    state.slideshowTickInFlight = true;
    fs.readdir(cfg.IMAGES_DIR, (err, files) => {
        state.slideshowTickInFlight = false;
        if (err || !files) return;

        const imageFiles = media.listImageFiles(files).filter(fileName => state.selectedImageFiles.has(fileName));
        if (imageFiles.length === 0) return;

        let selectedFile;
        if (state.slideshowOrder === 'random' && imageFiles.length > 1) {
            let nextIndex;
            do {
                nextIndex = Math.floor(Math.random() * imageFiles.length);
            } while (imageFiles[nextIndex] === state.lastBroadcast.fileName);
            state.currentImageIndex = nextIndex;
            selectedFile = imageFiles[state.currentImageIndex];
            state.currentImageIndex = (state.currentImageIndex + 1) % imageFiles.length;
        } else {
            let nextIndex = 0;
            if (state.lastBroadcast.fileName && imageFiles.includes(state.lastBroadcast.fileName)) {
                nextIndex = (imageFiles.indexOf(state.lastBroadcast.fileName) + 1) % imageFiles.length;
            } else if (state.currentImageIndex >= 0 && state.currentImageIndex < imageFiles.length) {
                nextIndex = state.currentImageIndex;
            }
            state.currentImageIndex = (nextIndex + 1) % imageFiles.length;
            selectedFile = imageFiles[nextIndex];
        }

        broadcastImage(selectedFile);
    });
}

function restartSlideshowTimer() {
    if (state.slideshowTimer) {
        clearTimeout(state.slideshowTimer);
        clearInterval(state.slideshowTimer);
        state.slideshowTimer = null;
    }
    if (state.isPlaybackPaused || state.isImagePinned || state.selectedImageFiles.size === 0) return;

    const currentFile = state.lastBroadcast.fileName;
    const durationSec = media.getMediaDuration(currentFile);
    // Hassas milisaniye zamanlaması + video için son karenin temiz gösterilmesi için 120ms tampon
    const waitMs = Math.max(1000, Math.round(durationSec * 1000) + (media.isVideoFile(currentFile) ? 120 : 0));
    state.slideshowTimer = setTimeout(() => {
        slideshowTick();
    }, waitMs);
}

// Belirtilen Resmi veya Videoyu Tüm Bağlı İstemcilere Gönderen Fonksiyon
function broadcastImage(fileName) {
    if (!state.selectedImageFiles.has(fileName)) return;

    const filePath = path.join(cfg.IMAGES_DIR, fileName);
    if (!fs.existsSync(filePath)) return;

    const isVid = media.isVideoFile(fileName);
    const mediaDuration = media.getMediaDuration(fileName);
    const nextMedia = playlist.buildNextMediaPayload(fileName);

    state.lastBroadcast = { fileName, time: Date.now() };

    const payload = {
        tip: 'image',
        mediaType: isVid ? 'video' : 'image',
        dosyaAdi: fileName,
        mediaUrl: isVid ? '/images/' + encodeURIComponent(fileName) : undefined,
        videoDuration: isVid ? mediaDuration : undefined,
        zaman: new Date().toLocaleTimeString(),
        slideInterval: isVid ? mediaDuration : settings.getSlideIntervalSec(),
        imageFit: settings.getImageFitMode(),
        showInfoBar: settings.getShowInfoBar(),
        transitionEffect: settings.getTransitionEffect(),
        slideshowOrder: settings.getSlideshowOrder(),
        showWatermark: settings.getShowWatermark(),
        activeImages: playlist.getActiveSelectedImages(),
        broadcastAt: state.lastBroadcast.time,
        nextMedia: nextMedia,
        isPinned: state.isImagePinned
    };

    if (state.clients.length === 0) {
        broadcast.broadcastDashboardUpdate();
        restartSlideshowTimer();
        return;
    }

    payload.resimData = null;
    broadcast.broadcastToAll(payload);
    broadcast.broadcastDashboardUpdate();
    restartSlideshowTimer();
}

Object.assign(module.exports, {
    broadcastImage,
    restartSlideshowTimer,
    sendCurrentBroadcastToClient,
    slideshowTick,
});
