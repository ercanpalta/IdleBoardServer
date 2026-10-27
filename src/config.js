const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

const AUTH_COOKIE_NAME = 'idleboard_admin_token';

const IMAGES_DIR = path.join(ROOT_DIR, 'images');

const THUMBNAILS_DIR = path.join(ROOT_DIR, 'thumbnails');

const DATA_DIR = path.join(ROOT_DIR, 'data');

if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Eski konumdaki (kök dizin) verileri otomatik olarak data/ dizinine taşı (Geriye dönük uyumluluk)
const legacyFilesToMigrate = [
    { oldPath: path.join(ROOT_DIR, 'selected-images.json'), newName: 'selected-images.json' },
    { oldPath: path.join(ROOT_DIR, 'server-settings.json'), newName: 'server-settings.json' },
    { oldPath: path.join(ROOT_DIR, 'activity-log.json'), newName: 'activity-log.json' },
    { oldPath: path.join(ROOT_DIR, 'admin-password.json'), newName: 'admin-password.json' }
];

for (const item of legacyFilesToMigrate) {
    const targetPath = path.join(DATA_DIR, item.newName);
    if (fs.existsSync(item.oldPath) && !fs.existsSync(targetPath)) {
        try {
            fs.renameSync(item.oldPath, targetPath);
        } catch (e) {
            try {
                fs.copyFileSync(item.oldPath, targetPath);
                fs.unlinkSync(item.oldPath);
            } catch (err) {}
        }
    }
}

const SELECTED_IMAGES_FILE = path.join(DATA_DIR, 'selected-images.json');

const SETTINGS_FILE = path.join(DATA_DIR, 'server-settings.json');

const ACTIVITY_LOG_FILE = path.join(DATA_DIR, 'activity-log.json');

const serverStartedAt = Date.now();

const MIN_INTERVAL_SEC = 1;

const MAX_INTERVAL_SEC = 300;

const MIN_IDLE_TIMEOUT_SEC = 1;

const MAX_IDLE_TIMEOUT_SEC = 86400; // 24 saat

const VALID_IMAGE_FITS = new Set(['uniform', 'uniformToFill', 'fill']);

const VALID_TRANSITION_EFFECTS = new Set(['fade', 'none']);

const VALID_SLIDESHOW_ORDERS = new Set(['sequential', 'random']);

const DEFAULT_PORT = 3000;

const MIN_PORT = 1024;

const MAX_PORT = 65535;

module.exports = {
    ROOT_DIR,
    AUTH_COOKIE_NAME,
    IMAGES_DIR,
    THUMBNAILS_DIR,
    DATA_DIR,
    legacyFilesToMigrate,
    SELECTED_IMAGES_FILE,
    SETTINGS_FILE,
    ACTIVITY_LOG_FILE,
    serverStartedAt,
    MIN_INTERVAL_SEC,
    MAX_INTERVAL_SEC,
    MIN_IDLE_TIMEOUT_SEC,
    MAX_IDLE_TIMEOUT_SEC,
    VALID_IMAGE_FITS,
    VALID_TRANSITION_EFFECTS,
    VALID_SLIDESHOW_ORDERS,
    DEFAULT_PORT,
    MIN_PORT,
    MAX_PORT,
};
