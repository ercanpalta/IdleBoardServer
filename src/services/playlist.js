const fs = require('fs');
const cfg = require('../config');
const broadcast = require('../services/broadcast');
const media = require('../services/media');
const settings = require('../services/settings');
const slideshow = require('../services/slideshow');
const state = require('../state');

function getActiveSelectedImages() {
    const imageFiles = media.listImageFiles(fs.readdirSync(cfg.IMAGES_DIR));
    return imageFiles.filter(fileName => state.selectedImageFiles.has(fileName));
}

function getNextMediaFile(currentFile) {
    const selectedList = getActiveSelectedImages();
    if (!selectedList || selectedList.length <= 1) return null;

    if (state.slideshowOrder === 'random') {
        const others = selectedList.filter(f => f !== currentFile);
        if (others.length > 0) {
            return others[Math.floor(Math.random() * others.length)];
        }
        return selectedList[0];
    }

    const currentIdx = selectedList.indexOf(currentFile);
    if (currentIdx !== -1) {
        return selectedList[(currentIdx + 1) % selectedList.length];
    }
    return selectedList[0];
}

function buildNextMediaPayload(currentFile) {
    const nextFile = getNextMediaFile(currentFile);
    if (!nextFile) return null;
    const isVid = media.isVideoFile(nextFile);
    const dur = isVid ? media.getMediaDuration(nextFile) : settings.getSlideIntervalSec();
    return {
        dosyaAdi: nextFile,
        mediaType: isVid ? 'video' : 'image',
        mediaUrl: '/images/' + encodeURIComponent(nextFile),
        videoDuration: isVid ? dur : null,
        slideInterval: dur
    };
}

function advanceSlide(step) {
    const selectedList = getActiveSelectedImages();
    if (selectedList.length === 0) return null;

    let targetIndex = 0;
    if (state.slideshowOrder === 'random' && selectedList.length > 1 && step > 0) {
        do {
            targetIndex = Math.floor(Math.random() * selectedList.length);
        } while (selectedList[targetIndex] === state.lastBroadcast.fileName);
    } else if (state.lastBroadcast.fileName) {
        const currentIdx = selectedList.indexOf(state.lastBroadcast.fileName);
        if (currentIdx !== -1) {
            targetIndex = (currentIdx + step + selectedList.length) % selectedList.length;
        } else {
            targetIndex = 0;
        }
    } else {
        targetIndex = step > 0 ? 0 : selectedList.length - 1;
    }

    state.currentImageIndex = targetIndex;
    const selectedFile = selectedList[state.currentImageIndex];
    slideshow.broadcastImage(selectedFile);
    state.currentImageIndex = (state.currentImageIndex + 1) % selectedList.length;

    if (!state.isPlaybackPaused && !state.isImagePinned) {
        slideshow.restartSlideshowTimer();
    }
    return selectedFile;
}

function loadSelectedImages() {
    const imageFiles = media.listImageFiles(fs.readdirSync(cfg.IMAGES_DIR));
    if (!fs.existsSync(cfg.SELECTED_IMAGES_FILE)) {
        saveSelectedImages(imageFiles);
        return;
    }

    let stored;
    try {
        stored = JSON.parse(fs.readFileSync(cfg.SELECTED_IMAGES_FILE, 'utf8'));
    } catch (e) {
        stored = null;
    }
    if (!Array.isArray(stored) || stored.some(fileName => typeof fileName !== 'string')) {
        // Bozuk dosya sunucunun açılmasını engellemesin; yedeklenip varsayılan seçimle devam edilir
        try { fs.copyFileSync(cfg.SELECTED_IMAGES_FILE, `${cfg.SELECTED_IMAGES_FILE}.corrupt`); } catch (e) {}
        console.error('[!] Galeri seçim yapılandırması geçersiz; tüm medya seçilerek devam ediliyor.');
        saveSelectedImages(imageFiles);
        return;
    }
    const availableImages = new Set(imageFiles);
    state.selectedImageFiles = new Set(stored.filter(fileName => availableImages.has(fileName)));
}

function broadcastActiveImages() {
    broadcast.broadcastToAll({
        tip: 'active_images',
        activeImages: getActiveSelectedImages()
    });
}

function saveSelectedImages(imageFiles) {
    const temporaryFile = `${cfg.SELECTED_IMAGES_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(imageFiles, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, cfg.SELECTED_IMAGES_FILE);
    state.selectedImageFiles = new Set(imageFiles);
    broadcastActiveImages();
}

Object.assign(module.exports, {
    advanceSlide,
    buildNextMediaPayload,
    getActiveSelectedImages,
    loadSelectedImages,
    saveSelectedImages,
});
