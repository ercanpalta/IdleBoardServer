const cfg = require('./config');

const state = {
    mediaMetadata: {},
    clients: [],
    currentImageIndex: 0,
    selectedImageFiles: new Set(),
    slideIntervalSec: 5,
    kioskIdleTimeoutSec: 5,
    imageFitMode: 'uniform',
    showInfoBar: true,
    showWatermark: false,
    watermarkFileName: null,
    transitionEffect: 'fade',
    slideshowOrder: 'sequential',
    serverPort: process.env.PORT ? parseInt(process.env.PORT, 10) : cfg.DEFAULT_PORT,
    slideshowTimer: null,
    slideshowTickInFlight: false,
    lastBroadcast: { fileName: null, time: 0 },
    isPlaybackPaused: false,
    isImagePinned: false,
    activityLog: [],
};

module.exports = state;
