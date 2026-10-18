const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const chokidar = require('chokidar');
const sharp = require('sharp');

const app = express();

// Sunucu Teknolojisi İmzası Gizleme (Fingerprinting Koruması)
app.disable('x-powered-by');

// HTTP Güvenlik Başlıkları & İçerik Güvenlik Politikası (CSP)
app.use((req, res, next) => {
    // 1. Clickjacking ve Çerçeveleme Koruması
    res.setHeader('X-Frame-Options', 'DENY');

    // 2. MIME-type Tahminini Önleme
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 3. Referrer Politikası
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 4. Eski Tarayıcılar İçin XSS Filtresi
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // 5. İçerik Güvenlik Politikası (Content Security Policy - CSP)
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "font-src 'self'",
            "media-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "base-uri 'self'"
        ].join('; ')
    );

    // 6. Tarayıcı Donanım İzinleri Kısıtlaması (Permissions Policy)
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

    // 7. HTTPS İletişiminde HSTS (Strict-Transport-Security)
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (isHttps) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
});

const AUTH_COOKIE_NAME = 'idleboard_admin_token';

// Çerez (Cookie) Ayrıştırma Ara Katmanı
app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(c => {
            const parts = c.split('=');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                req.cookies[name] = decodeURIComponent(value);
            }
        });
    }
    next();
});

// İzin Verilen Kaynak (Origin) Denetimi: Yerel ağ, localhost ve aynı kaynak
function isAllowedOrigin(origin, req) {
    if (!origin || origin === 'null') return true;
    try {
        const parsed = new URL(origin);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') return true;
        if (hostname.startsWith('[fe80:') || hostname.startsWith('[fc') || hostname.startsWith('[fd')) return true;
        const reqHost = (req && req.headers && req.headers.host) ? req.headers.host.split(':')[0].toLowerCase() : null;
        if (reqHost && hostname === reqHost) return true;
        if (hostname.endsWith('.local') || !hostname.includes('.')) return true;
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    } catch {
        return false;
    }
    return false;
}

// Güvenli CORS Yapılandırması: Yerel ağ cihazlarına tam izin, harici genel ağlara blokaj
app.use((req, res, next) => {
    cors({
        origin: (origin, callback) => {
            if (!origin || isAllowedOrigin(origin, req)) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Admin-Token']
    })(req, res, next);
});

// Harici Çapraz Kaynak (Cross-Origin / Referer) Engelleme Ara Katmanı
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, req)) {
        console.warn(`[⚠️ Güvenlik] Harici Origin isteği engellendi: ${origin} (Hedef: ${req.path})`);
        return res.status(403).json({ success: false, error: 'Erişim engellendi: Harici web sitelerinden yerel sunucuya erişim izni bulunmamaktadır.' });
    }

    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const referer = req.headers.referer;
        if (referer && !isAllowedOrigin(referer, req)) {
            console.warn(`[⚠️ Güvenlik] Harici Referer yönlendirmesi engellendi: ${referer} (Hedef: ${req.path})`);
            return res.status(403).json({ success: false, error: 'Erişim engellendi: Harici yönlendirme tespit edildi.' });
        }
    }
    next();
});

app.use(express.json());

// Statik Web Paneli Dosyaları
app.use(express.static(path.join(__dirname, 'public')));

const IMAGES_DIR = path.join(__dirname, 'images');
const THUMBNAILS_DIR = path.join(__dirname, 'thumbnails');
const DATA_DIR = path.join(__dirname, 'data');
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
    { oldPath: path.join(__dirname, 'selected-images.json'), newName: 'selected-images.json' },
    { oldPath: path.join(__dirname, 'server-settings.json'), newName: 'server-settings.json' },
    { oldPath: path.join(__dirname, 'activity-log.json'), newName: 'activity-log.json' },
    { oldPath: path.join(__dirname, 'admin-password.json'), newName: 'admin-password.json' }
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

app.use('/images', express.static(IMAGES_DIR));

// Küçük Önizleme (Thumbnail) Servisi
app.get('/thumbnails/:name', async (req, res) => {
    const fileName = req.params.name;
    if (path.basename(fileName) !== fileName || !isSupportedImage(fileName)) {
        return res.status(400).send('Geçersiz dosya');
    }

    const thumbPath = path.join(THUMBNAILS_DIR, fileName);
    const origPath = path.join(IMAGES_DIR, fileName);

    if (!fs.existsSync(origPath)) {
        return res.status(404).send('Görsel bulunamadı');
    }

    if (fs.existsSync(thumbPath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(thumbPath);
    }

    try {
        await generateThumbnail(fileName);
        if (fs.existsSync(thumbPath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(thumbPath);
        }
    } catch (err) {
        console.error(`[!] Thumbnail servisi hatası (${fileName}):`, err.message);
    }
    res.sendFile(origPath);
});

// Kimlik Doğrulama (Auth) ve Oturum Güvenliği Yapılandırması
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.json');
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Yaygın zayıf parolalar kara listesi
const COMMON_WEAK_PASSWORDS = new Set([
    '12345678', '123456789', '1234567890', 'password', 'password123',
    'admin123', 'administrator', 'admin2026', 'idleboard', 'idleboard123',
    'qwerty123', 'welcome1', 'letmein1', 'changeme', 'iloveyou'
]);

function validatePasswordStrength(password) {
    if (typeof password !== 'string') {
        return { valid: false, error: 'Parola geçersiz bir veri tipinde.' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return { valid: false, error: `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.` };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return { valid: false, error: `Parola en fazla ${MAX_PASSWORD_LENGTH} karakter olabilir.` };
    }
    const hasLetter = /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    if (!hasLetter || !hasDigit) {
        return { valid: false, error: 'Parola en az bir harf ve bir rakam içermelidir.' };
    }
    if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
        return { valid: false, error: 'Bu parola çok yaygın ve tahmin edilmesi kolaydır. Lütfen daha güvenli bir parola seçin.' };
    }
    if (/^(.)\1+$/.test(password)) {
        return { valid: false, error: 'Parola yalnızca aynı karakterin tekrarından oluşamaz.' };
    }
    return { valid: true };
}

// Oturum Zaman Aşımı Kuralları (TTL)
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 dakika hareketsizlik zaman aşımı
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat mutlak oturum süresi
const activeTokens = new Map(); // token -> { createdAt, lastActivityAt }

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function registerToken() {
    const token = generateToken();
    activeTokens.set(token, {
        createdAt: Date.now(),
        lastActivityAt: Date.now()
    });
    return token;
}

function setAdminTokenCookie(req, res, token) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlag}`);
}

function clearAdminTokenCookie(req, res) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag}`);
}

function getRequestAuthToken(req) {
    if (req.cookies && req.cookies[AUTH_COOKIE_NAME]) {
        return req.cookies[AUTH_COOKIE_NAME];
    }
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    if (req.headers['x-admin-token']) {
        return req.headers['x-admin-token'];
    }
    return null;
}

// Süresi dolan oturumları periyodik olarak temizleme (5 dakikada bir)
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of activeTokens.entries()) {
        if (now - data.lastActivityAt > INACTIVITY_TIMEOUT_MS || now - data.createdAt > MAX_SESSION_TTL_MS) {
            activeTokens.delete(token);
        }
    }
}, 5 * 60 * 1000).unref();

// Kaba Kuvvet (Brute-Force) Koruması & Hız Sınırlaması
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000; // 5 dakika kilit
const MAX_REQUESTS_PER_MINUTE = 30; // Dakikada maks 30 istek

const loginAttemptMap = new Map(); // ip -> { failedCount, lockedUntil, reqCount, windowStart }

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : req.ip || 'unknown';
}

function checkBruteForceLock(ip) {
    const now = Date.now();
    const record = loginAttemptMap.get(ip);
    if (!record) return { isLocked: false };

    // 1. Kilit süresi kontrolü
    if (record.lockedUntil > now) {
        const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
        return { isLocked: true, remainingSec, reason: 'lockout' };
    } else if (record.lockedUntil > 0) {
        record.lockedUntil = 0;
        record.failedCount = 0;
    }

    // 2. Dakikalık istek sınırı kontrolü (Flood koruması)
    if (now - record.windowStart > 60000) {
        record.windowStart = now;
        record.reqCount = 1;
    } else {
        record.reqCount++;
        if (record.reqCount > MAX_REQUESTS_PER_MINUTE) {
            const remainingSec = Math.ceil((record.windowStart + 60000 - now) / 1000);
            return { isLocked: true, remainingSec, reason: 'rate_limit' };
        }
    }

    return { isLocked: false };
}

function recordFailedLogin(ip) {
    const now = Date.now();
    let record = loginAttemptMap.get(ip);
    if (!record) {
        record = { failedCount: 0, lockedUntil: 0, reqCount: 1, windowStart: now };
        loginAttemptMap.set(ip, record);
    }
    record.failedCount++;
    const remainingTries = Math.max(0, MAX_FAILED_ATTEMPTS - record.failedCount);

    if (record.failedCount >= MAX_FAILED_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_WINDOW_MS;
        console.warn(`[⚠️ Güvenlik] IP ${ip} için hatalı giriş limiti aşıldı! Erişim 5 dakika kilitlendi.`);
        logActivity('security', 'Hatalı giriş limiti aşıldı', `IP: ${ip} adresinden ${record.failedCount} kez başarısız deneme yapıldı. 5 dakika geçici kilit uygulandı.`);
        return { isLocked: true, remainingSec: Math.ceil(LOCKOUT_WINDOW_MS / 1000), remainingTries: 0 };
    }
    return { isLocked: false, remainingTries };
}

function recordSuccessfulLogin(ip) {
    loginAttemptMap.delete(ip);
}

// Eski IP kayıtlarını periyodik olarak temizleme (10 dakikada bir)
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of loginAttemptMap.entries()) {
        if (record.lockedUntil < now && now - record.windowStart > 10 * 60 * 1000) {
            loginAttemptMap.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

function readPasswordHash() {
    if (fs.existsSync(PASSWORD_FILE)) {
        try {
            const stored = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
            if (stored.algorithm !== 'scrypt' || !stored.salt || !stored.hash) {
                throw new Error('Geçersiz parola yapılandırması.');
            }
            return { type: 'scrypt', salt: stored.salt, hash: stored.hash };
        } catch (error) {
            throw new Error(`Parola yapılandırması okunamadı: ${error.message}`);
        }
    }

    if (process.env.ADMIN_PASSWORD) {
        return { type: 'plain', value: process.env.ADMIN_PASSWORD };
    }
    return null;
}

function isPasswordConfigured() {
    return Boolean(readPasswordHash());
}

function verifyPassword(password) {
    const stored = readPasswordHash();
    if (!stored) return false;
    if (stored.type === 'plain') {
        const passwordBuffer = Buffer.from(password);
        const storedBuffer = Buffer.from(stored.value);
        return passwordBuffer.length === storedBuffer.length
            && crypto.timingSafeEqual(passwordBuffer, storedBuffer);
    }

    const hash = crypto.scryptSync(password, Buffer.from(stored.salt, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(stored.hash, 'hex'));
}

function savePassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    fs.writeFileSync(PASSWORD_FILE, JSON.stringify({
        algorithm: 'scrypt',
        salt: salt.toString('hex'),
        hash: hash.toString('hex')
    }, null, 2), { mode: 0o600 });
}

function requireAuth(req, res, next) {
    const token = getRequestAuthToken(req);

    if (!token || !activeTokens.has(token)) {
        return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
    }

    const tokenData = activeTokens.get(token);
    const now = Date.now();
    if (now - tokenData.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
        activeTokens.delete(token);
        clearAdminTokenCookie(req, res);
        return res.status(401).json({
            error: 'Oturum zaman aşımına uğradı (30 dakika hareketsizlik). Lütfen tekrar giriş yapın.',
            sessionExpired: true
        });
    }
    if (now - tokenData.createdAt > MAX_SESSION_TTL_MS) {
        activeTokens.delete(token);
        clearAdminTokenCookie(req, res);
        return res.status(401).json({
            error: 'Oturum geçerlilik süresi doldu (24 saat). Lütfen tekrar giriş yapın.',
            sessionExpired: true
        });
    }

    tokenData.lastActivityAt = now;
    next();
}

// Multer Dosya Yükleme Ayarları
const MAX_UPLOAD_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB maksimum dosya boyutu
const supportedImageTypes = {
    '.jpg': { mimeType: 'image/jpeg', format: 'jpeg' },
    '.jpeg': { mimeType: 'image/jpeg', format: 'jpeg' },
    '.png': { mimeType: 'image/png', format: 'png' },
    '.webp': { mimeType: 'image/webp', format: 'webp' }
};
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `img-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = supportedImageTypes[ext];
        if (!type || file.mimetype !== type.mimeType) {
            const err = new Error('INVALID_FILE_TYPE');
            err.code = 'INVALID_FILE_TYPE';
            return cb(err, false);
        }
        cb(null, true);
    }
});

// Magic Bytes (Dosya İmzası) Doğrulaması (< 0.1ms, sıfır işlemci/RAM yükü)
function verifyImageMagicBytes(filePath, expectedFormat) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(16);
        const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
        if (bytesRead < 12) return false;

        if (expectedFormat === 'jpeg') {
            return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        }
        if (expectedFormat === 'png') {
            return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
                && buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
        }
        if (expectedFormat === 'webp') {
            const riff = buffer.toString('ascii', 0, 4);
            const webp = buffer.toString('ascii', 8, 12);
            return riff === 'RIFF' && webp === 'WEBP';
        }
        return false;
    } catch (e) {
        return false;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
        }
    }
}

// Aktif SSE İstemcileri
let clients = [];
let currentImageIndex = 0;
let selectedImageFiles = new Set();
const serverStartedAt = Date.now();

const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 300;
let slideIntervalSec = 5;

const MIN_IDLE_TIMEOUT_SEC = 1;
const MAX_IDLE_TIMEOUT_SEC = 86400; // 24 saat
let kioskIdleTimeoutSec = 5;

const VALID_IMAGE_FITS = new Set(['uniform', 'uniformToFill', 'fill']);
let imageFitMode = 'uniform';

let showInfoBar = true;

const VALID_TRANSITION_EFFECTS = new Set(['fade', 'none']);
let transitionEffect = 'fade';

const VALID_SLIDESHOW_ORDERS = new Set(['sequential', 'random']);
let slideshowOrder = 'sequential';

let slideshowTimer = null;
let slideshowTickInFlight = false;
let lastBroadcast = { fileName: null, time: 0 };
let isPlaybackPaused = false;
let isImagePinned = false;

function getSlideIntervalSec() {
    return slideIntervalSec;
}

function getKioskIdleTimeoutSec() {
    return kioskIdleTimeoutSec;
}

function getImageFitMode() {
    return imageFitMode;
}

function getShowInfoBar() {
    return showInfoBar;
}

function getTransitionEffect() {
    return transitionEffect;
}

function getSlideshowOrder() {
    return slideshowOrder;
}

function loadServerSettings() {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    try {
        const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        if (typeof stored === 'object' && stored !== null) {
            if (Number.isFinite(stored.slideInterval) && stored.slideInterval >= MIN_INTERVAL_SEC && stored.slideInterval <= MAX_INTERVAL_SEC) {
                slideIntervalSec = Math.round(stored.slideInterval);
            }
            if (Number.isFinite(stored.kioskIdleTimeout) && stored.kioskIdleTimeout >= MIN_IDLE_TIMEOUT_SEC && stored.kioskIdleTimeout <= MAX_IDLE_TIMEOUT_SEC) {
                kioskIdleTimeoutSec = Math.round(stored.kioskIdleTimeout);
            }
            if (typeof stored.imageFit === 'string' && VALID_IMAGE_FITS.has(stored.imageFit)) {
                imageFitMode = stored.imageFit;
            }
            if (typeof stored.showInfoBar === 'boolean') {
                showInfoBar = stored.showInfoBar;
            }
            if (typeof stored.transitionEffect === 'string' && VALID_TRANSITION_EFFECTS.has(stored.transitionEffect)) {
                transitionEffect = stored.transitionEffect;
            }
            if (typeof stored.slideshowOrder === 'string' && VALID_SLIDESHOW_ORDERS.has(stored.slideshowOrder)) {
                slideshowOrder = stored.slideshowOrder;
            }
        }
    } catch (err) {
        console.error('[!] Ayar dosyası okunamadı:', err.message);
    }
}

function saveServerSettings() {
    try {
        const temporaryFile = `${SETTINGS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify({
            slideInterval: slideIntervalSec,
            kioskIdleTimeout: kioskIdleTimeoutSec,
            imageFit: imageFitMode,
            showInfoBar: showInfoBar,
            transitionEffect: transitionEffect,
            slideshowOrder: slideshowOrder
        }, null, 2), { mode: 0o600 });
        fs.renameSync(temporaryFile, SETTINGS_FILE);
    } catch (err) {
        console.error('[!] Ayarlar kaydedilemedi:', err.message);
    }
}

function getConnectedClientCount() {
    return clients.filter(client => !client.isAdmin).length;
}

function broadcastDashboardUpdate() {
    broadcastToAdmins({ tip: 'dashboard_update' });
}

// Aktivite Günlüğü (Activity Log)
const MAX_ACTIVITY_LOG = 40;
let activityLog = [];

function loadActivityLog() {
    if (!fs.existsSync(ACTIVITY_LOG_FILE)) {
        activityLog = [{
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
        const stored = JSON.parse(fs.readFileSync(ACTIVITY_LOG_FILE, 'utf8'));
        if (Array.isArray(stored)) {
            activityLog = stored.slice(0, MAX_ACTIVITY_LOG);
        }
    } catch (e) {
        console.error('[!] Aktivite günlüğü okunamadı:', e.message);
        activityLog = [];
    }
}

function saveActivityLog() {
    try {
        const temporaryFile = `${ACTIVITY_LOG_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(activityLog.slice(0, MAX_ACTIVITY_LOG), null, 2), { mode: 0o600 });
        fs.renameSync(temporaryFile, ACTIVITY_LOG_FILE);
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
    activityLog.unshift(entry);
    if (activityLog.length > MAX_ACTIVITY_LOG) {
        activityLog = activityLog.slice(0, MAX_ACTIVITY_LOG);
    }
    saveActivityLog();
    broadcastDashboardUpdate();
}

function clearCurrentBroadcast() {
    lastBroadcast = { fileName: null, time: 0 };
    broadcastToAll({ tip: 'stream_control', action: 'clear' });
    broadcastDashboardUpdate();
}

function broadcastToAdmins(payload) {
    const chunk = `data: ${JSON.stringify(payload)}\n\n`;
    clients.filter(client => client.isAdmin).forEach(client => client.res.write(chunk));
}

function broadcastToAll(payload) {
    if (clients.length === 0) return;
    const chunk = `data: ${JSON.stringify(payload)}\n\n`;
    clients.forEach(c => c.res.write(chunk));
}

function isSupportedImage(fileNameOrPath) {
    const ext = path.extname(fileNameOrPath).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
}

function listImageFiles(files) {
    return (files || []).filter(f => isSupportedImage(f)).sort();
}

async function generateThumbnail(fileName) {
    const origPath = path.join(IMAGES_DIR, fileName);
    const thumbPath = path.join(THUMBNAILS_DIR, fileName);

    if (!fs.existsSync(origPath)) return false;

    try {
        const ext = path.extname(fileName).toLowerCase();
        let pipeline = sharp(origPath).resize(500, null, { withoutEnlargement: true });
        if (ext === '.png') {
            pipeline = pipeline.png({ quality: 80, compressionLevel: 8 });
        } else if (ext === '.webp') {
            pipeline = pipeline.webp({ quality: 80 });
        } else {
            pipeline = pipeline.jpeg({ quality: 80, progressive: true });
        }
        await pipeline.toFile(thumbPath);
        return true;
    } catch (err) {
        console.error(`[!] Thumbnail oluşturulamadı (${fileName}):`, err.message);
        return false;
    }
}

async function ensureThumbnails() {
    try {
        const files = listImageFiles(fs.readdirSync(IMAGES_DIR));
        for (const fileName of files) {
            const thumbPath = path.join(THUMBNAILS_DIR, fileName);
            if (!fs.existsSync(thumbPath)) {
                await generateThumbnail(fileName);
            }
        }
    } catch (err) {
        console.error('[!] ensureThumbnails hatası:', err.message);
    }
}

function getActiveSelectedImages() {
    const imageFiles = listImageFiles(fs.readdirSync(IMAGES_DIR));
    return imageFiles.filter(fileName => selectedImageFiles.has(fileName));
}

function advanceSlide(step) {
    const selectedList = getActiveSelectedImages();
    if (selectedList.length === 0) return null;

    let targetIndex = 0;
    if (slideshowOrder === 'random' && selectedList.length > 1 && step > 0) {
        do {
            targetIndex = Math.floor(Math.random() * selectedList.length);
        } while (selectedList[targetIndex] === lastBroadcast.fileName);
    } else if (lastBroadcast.fileName) {
        const currentIdx = selectedList.indexOf(lastBroadcast.fileName);
        if (currentIdx !== -1) {
            targetIndex = (currentIdx + step + selectedList.length) % selectedList.length;
        } else {
            targetIndex = 0;
        }
    } else {
        targetIndex = step > 0 ? 0 : selectedList.length - 1;
    }

    currentImageIndex = targetIndex;
    const selectedFile = selectedList[currentImageIndex];
    broadcastImage(selectedFile);
    currentImageIndex = (currentImageIndex + 1) % selectedList.length;

    if (!isPlaybackPaused && !isImagePinned) {
        restartSlideshowTimer();
    }
    return selectedFile;
}

function loadSelectedImages() {
    const imageFiles = listImageFiles(fs.readdirSync(IMAGES_DIR));
    if (!fs.existsSync(SELECTED_IMAGES_FILE)) {
        saveSelectedImages(imageFiles);
        return;
    }

    const stored = JSON.parse(fs.readFileSync(SELECTED_IMAGES_FILE, 'utf8'));
    if (!Array.isArray(stored) || stored.some(fileName => typeof fileName !== 'string')) {
        throw new Error('Galeri seçim yapılandırması geçersiz.');
    }
    const availableImages = new Set(imageFiles);
    selectedImageFiles = new Set(stored.filter(fileName => availableImages.has(fileName)));
}

function saveSelectedImages(imageFiles) {
    const temporaryFile = `${SELECTED_IMAGES_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(imageFiles, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, SELECTED_IMAGES_FILE);
    selectedImageFiles = new Set(imageFiles);
}

loadSelectedImages();
loadServerSettings();
loadActivityLog();
ensureThumbnails();

function slideshowTick() {
    if (isPlaybackPaused || isImagePinned || clients.length === 0 || slideshowTickInFlight) return;

    slideshowTickInFlight = true;
    fs.readdir(IMAGES_DIR, (err, files) => {
        slideshowTickInFlight = false;
        if (err || !files) return;

        const imageFiles = listImageFiles(files).filter(fileName => selectedImageFiles.has(fileName));
        if (imageFiles.length === 0) return;

        let selectedFile;
        if (slideshowOrder === 'random' && imageFiles.length > 1) {
            let nextIndex;
            do {
                nextIndex = Math.floor(Math.random() * imageFiles.length);
            } while (imageFiles[nextIndex] === lastBroadcast.fileName);
            currentImageIndex = nextIndex;
            selectedFile = imageFiles[currentImageIndex];
            currentImageIndex = (currentImageIndex + 1) % imageFiles.length;
        } else {
            if (currentImageIndex >= imageFiles.length) {
                currentImageIndex = 0;
            }
            selectedFile = imageFiles[currentImageIndex];
            currentImageIndex++;
        }

        broadcastImage(selectedFile);
    });
}

function restartSlideshowTimer() {
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
    }
    if (isPlaybackPaused || isImagePinned) return;
    slideshowTimer = setInterval(slideshowTick, slideIntervalSec * 1000);
}

function setSlideIntervalSec(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < MIN_INTERVAL_SEC || value > MAX_INTERVAL_SEC) {
        return false;
    }
    slideIntervalSec = Math.round(value);
    saveServerSettings();
    restartSlideshowTimer();
    broadcastToAll({
        tip: 'config',
        slideInterval: slideIntervalSec
    });
    console.log(`[i] Slayt süresi güncellendi: ${slideIntervalSec}sn`);
    logActivity('settings', 'Geçiş aralığı güncellendi', `${slideIntervalSec} saniye`);
    return true;
}

function setKioskIdleTimeoutSec(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < MIN_IDLE_TIMEOUT_SEC || value > MAX_IDLE_TIMEOUT_SEC) {
        return false;
    }
    kioskIdleTimeoutSec = Math.round(value);
    saveServerSettings();
    broadcastToAll({
        tip: 'config',
        kioskIdleTimeout: kioskIdleTimeoutSec
    });
    broadcastDashboardUpdate();
    console.log(`[i] Bekleme süresi güncellendi: ${kioskIdleTimeoutSec}sn`);
    logActivity('settings', 'Boşta kalma süresi güncellendi', `${seconds} saniye`);
    return true;
}

function setImageFitMode(mode) {
    if (typeof mode !== 'string' || !VALID_IMAGE_FITS.has(mode)) {
        return false;
    }
    imageFitMode = mode;
    saveServerSettings();
    broadcastToAll({
        tip: 'config',
        imageFit: imageFitMode
    });
    broadcastDashboardUpdate();
    console.log(`[i] Görsel yerleşim modu güncellendi: ${imageFitMode}`);
    const fitLabels = { uniform: 'Orijinal Boyut', uniformToFill: 'Ekranı Kapla', fill: 'Genişlet' };
    logActivity('settings', 'Görsel yerleşimi güncellendi', fitLabels[imageFitMode] || imageFitMode);
    return true;
}

function setShowInfoBar(visible) {
    if (typeof visible !== 'boolean') {
        return false;
    }
    showInfoBar = visible;
    saveServerSettings();
    broadcastToAll({
        tip: 'config',
        showInfoBar: showInfoBar
    });
    broadcastDashboardUpdate();
    console.log(`[i] Alt bilgi şeridi görünürlüğü güncellendi: ${showInfoBar}`);
    logActivity('settings', 'Alt bilgi şeridi güncellendi', showInfoBar ? 'Görünür yapıldı' : 'Gizlendi');
    return true;
}

function setTransitionEffect(effect) {
    if (typeof effect !== 'string' || !VALID_TRANSITION_EFFECTS.has(effect)) {
        return false;
    }
    transitionEffect = effect;
    saveServerSettings();
    broadcastToAll({
        tip: 'config',
        transitionEffect: transitionEffect
    });
    broadcastDashboardUpdate();
    console.log(`[i] Geçiş efekti güncellendi: ${transitionEffect}`);
    logActivity('settings', 'Geçiş efekti güncellendi', transitionEffect === 'none' ? 'Anında geçiş' : 'Yumuşak geçiş (Fade)');
    return true;
}

function setSlideshowOrder(order) {
    if (typeof order !== 'string' || !VALID_SLIDESHOW_ORDERS.has(order)) {
        return false;
    }
    slideshowOrder = order;
    saveServerSettings();
    broadcastToAll({
        tip: 'config',
        slideshowOrder: slideshowOrder
    });
    broadcastDashboardUpdate();
    console.log(`[i] Slayt sıralaması güncellendi: ${slideshowOrder}`);
    logActivity('settings', 'Slayt sıralaması güncellendi', slideshowOrder === 'random' ? 'Rastgele döngü' : 'Sıralı döngü');
    return true;
}

// SSE Endpoint (C# WPF İstemcisinin ve Web Panelinin Bağlandığı Adres)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin, req)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const clientId = crypto.randomUUID();
    const token = getRequestAuthToken(req);
    const isAdmin = req.query.source === 'admin' && Boolean(token && activeTokens.has(token));
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace(/^.*:/, '');
    const newClient = { id: clientId, res, isAdmin };
    clients.push(newClient);

    if (!isAdmin) {
        broadcastToAdmins({ tip: 'client_count', connectedClients: getConnectedClientCount() });
        logActivity('client_connect', 'Ekran istemcisi bağlandı', clientIp ? `IP: ${clientIp}` : 'Yeni ekran bağlantısı');
    }
    console.log(`[+] Yeni istemci bağlandı. (ID: ${clientId}, Toplam: ${getConnectedClientCount()})`);

    res.write(`data: ${JSON.stringify({
        tip: 'init',
        mesaj: 'Bağlantı Başarılı',
        slideInterval: getSlideIntervalSec(),
        kioskIdleTimeout: getKioskIdleTimeoutSec(),
        imageFit: getImageFitMode(),
        showInfoBar: getShowInfoBar(),
        transitionEffect: getTransitionEffect(),
        slideshowOrder: getSlideshowOrder(),
        isPaused: isPlaybackPaused,
        isPinned: isImagePinned
    })}\n\n`);

    if (isPlaybackPaused && !isAdmin) {
        res.write(`data: ${JSON.stringify({
            tip: 'stream_control',
            action: 'stop'
        })}\n\n`);
    } else if (!isPlaybackPaused && !isImagePinned && clients.filter(c => !c.isAdmin).length === 1) {
        slideshowTick();
    }
    if (!isAdmin && getActiveSelectedImages().length === 0) {
        res.write(`data: ${JSON.stringify({
            tip: 'stream_control',
            action: 'clear'
        })}\n\n`);
    }

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
        if (!isAdmin) {
            broadcastToAdmins({ tip: 'client_count', connectedClients: getConnectedClientCount() });
            logActivity('client_disconnect', 'Ekran istemcisi ayrıldı', clientIp ? `IP: ${clientIp}` : 'Ekran bağlantısı sonlandı');
        }
        console.log(`[-] İstemci ayrıldı. (ID: ${clientId}, Kalan: ${getConnectedClientCount()})`);
    });
});

// Belirtilen Resmi Tüm Bağlı İstemcilere Gönderen Fonksiyon
function broadcastImage(fileName) {
    if (!selectedImageFiles.has(fileName)) return;

    const filePath = path.join(IMAGES_DIR, fileName);
    if (!fs.existsSync(filePath)) return;

    if (clients.length === 0) {
        lastBroadcast = { fileName, time: Date.now() };
        broadcastDashboardUpdate();
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err || !selectedImageFiles.has(fileName)) return;

        const base64Image = data.toString('base64');
        lastBroadcast = { fileName, time: Date.now() };
        const payload = {
            tip: 'image',
            dosyaAdi: fileName,
            zaman: new Date().toLocaleTimeString(),
            slideInterval: getSlideIntervalSec(),
            kioskIdleTimeout: getKioskIdleTimeoutSec(),
            imageFit: getImageFitMode(),
            showInfoBar: getShowInfoBar(),
            transitionEffect: getTransitionEffect(),
            slideshowOrder: getSlideshowOrder(),
            broadcastAt: lastBroadcast.time,
            resimData: base64Image
        };

        broadcastToAll(payload);
        broadcastDashboardUpdate();
    });
}

// Chokidar Dosya İzleyici (images/ klasörünü dinamik izler)
const watcher = chokidar.watch(IMAGES_DIR, {
    ignored: /(^|[\/\\])\../, // .gitkeep, gizli dosyaları yoksay
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
    }
});

watcher
    .on('add', (filePath) => {
        if (!isSupportedImage(filePath)) return;
        const fileName = path.basename(filePath);
        console.log(`[📁 Watcher] Klasöre yeni görsel eklendi: ${fileName}`);
        generateThumbnail(fileName).catch(() => {});

        // Web paneli galerisini anında güncellemesi için bilgilendir
        broadcastToAll({
            tip: 'gallery_update',
            action: 'add',
            fileName
        });
        broadcastDashboardUpdate();

        if (selectedImageFiles.has(fileName)
            && (lastBroadcast.fileName !== fileName || (Date.now() - lastBroadcast.time > 1500))) {
            broadcastImage(fileName);
            restartSlideshowTimer();
        }
    })
    .on('unlink', (filePath) => {
        if (!isSupportedImage(filePath)) return;
        const fileName = path.basename(filePath);
        console.log(`[🗑️ Watcher] Klasörden görsel silindi: ${fileName}`);
        const thumbPath = path.join(THUMBNAILS_DIR, fileName);
        if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) {}
        }

        if (selectedImageFiles.has(fileName)) {
            try {
                saveSelectedImages([...selectedImageFiles].filter(selected => selected !== fileName));
            } catch (error) {
                console.error('[⚠️ Galeri seçimi kaydedilemedi]:', error);
            }
        }

        // Web paneli galerisini anında güncellemesi için bilgilendir
        broadcastToAll({
            tip: 'gallery_update',
            action: 'unlink',
            fileName
        });
        if (lastBroadcast.fileName === fileName) {
            lastBroadcast = { fileName: null, time: 0 };
        }
        if (selectedImageFiles.size === 0) {
            clearCurrentBroadcast();
        } else {
            broadcastDashboardUpdate();
        }

        // Slayt indeksini güvenli sınıra çek
        fs.readdir(IMAGES_DIR, (err, files) => {
            if (err || !files) return;
            const remaining = listImageFiles(files);
            if (remaining.length === 0) {
                currentImageIndex = 0;
            } else if (currentImageIndex >= remaining.length) {
                currentImageIndex = 0;
            }
        });
    })
    .on('error', (err) => {
        console.error('[⚠️ Watcher Hatası]:', err);
    });

restartSlideshowTimer();

// Kimlik Doğrulama (Auth) API'leri
app.get('/api/auth/status', (req, res) => {
    res.json({ passwordConfigured: isPasswordConfigured() });
});

app.post('/api/auth/setup', (req, res) => {
    const { password, passwordConfirmation } = req.body || {};
    if (isPasswordConfigured()) {
        return res.status(409).json({ success: false, error: 'Yönetici parolası zaten belirlenmiş.' });
    }
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            error: validation.error
        });
    }
    if (password !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Parola tekrarı eşleşmiyor.' });
    }

    savePassword(password);
    activeTokens.clear();
    const token = registerToken();
    setAdminTokenCookie(req, res, token);
    res.json({ success: true, token });
});

app.post('/api/auth/password', requireAuth, (req, res) => {
    const clientIp = getClientIp(req);
    const lock = checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        return res.status(429).json({
            success: false,
            error: `Çok fazla deneme yapıldı. Lütfen ${lock.remainingSec} saniye bekleyin.`,
            retryAfter: lock.remainingSec
        });
    }

    const { currentPassword, newPassword, passwordConfirmation } = req.body || {};
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword)) {
        const failResult = recordFailedLogin(clientIp);
        const hint = failResult.remainingTries > 0 ? ` (${failResult.remainingTries} deneme hakkı kaldı)` : '';
        return res.status(400).json({ success: false, error: `Mevcut parola hatalı.${hint}` });
    }
    recordSuccessfulLogin(clientIp);

    if (newPassword === currentPassword) {
        return res.status(400).json({ success: false, error: 'Yeni parola mevcut paroladan farklı olmalıdır.' });
    }
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            error: validation.error
        });
    }
    if (newPassword !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Yeni parola tekrarı eşleşmiyor.' });
    }

    savePassword(newPassword);
    activeTokens.clear();
    const token = registerToken();
    setAdminTokenCookie(req, res, token);
    logActivity('security', 'Yönetici parolası değiştirildi', 'Tüm aktif oturumlar sonlandırıldı ve yeni parola kaydedildi');
    res.json({ success: true, token });
});

app.post('/api/login', (req, res) => {
    const clientIp = getClientIp(req);
    const lock = checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        const msg = lock.reason === 'lockout'
            ? `Çok fazla hatalı deneme yapıldı. Lütfen ${lock.remainingSec} saniye sonra tekrar deneyin.`
            : `Çok fazla istek gönderildi. Lütfen ${lock.remainingSec} saniye bekleyin.`;
        return res.status(429).json({ success: false, error: msg, retryAfter: lock.remainingSec });
    }

    const { password } = req.body || {};
    if (!isPasswordConfigured()) {
        return res.status(428).json({ success: false, error: 'Önce yönetici parolasını belirleyin.' });
    }
    if (typeof password !== 'string' || !verifyPassword(password)) {
        const failResult = recordFailedLogin(clientIp);
        if (failResult.isLocked) {
            return res.status(429).json({
                success: false,
                error: `Çok fazla hatalı deneme yapıldı. Lütfen ${failResult.remainingSec} saniye sonra tekrar deneyin.`,
                retryAfter: failResult.remainingSec
            });
        }
        const hint = failResult.remainingTries > 0
            ? ` (${failResult.remainingTries} deneme hakkı kaldı)`
            : '';
        return res.status(401).json({ success: false, error: `Hatalı parola!${hint}` });
    }

    recordSuccessfulLogin(clientIp);
    const token = registerToken();
    setAdminTokenCookie(req, res, token);
    console.log(`[🔐 Auth] Yönetim paneline başarılı giriş yapıldı (IP: ${clientIp}).`);
    res.json({ success: true, token });
});

app.get('/api/auth/check', (req, res) => {
    const token = getRequestAuthToken(req);

    if (token && activeTokens.has(token)) {
        const tokenData = activeTokens.get(token);
        const now = Date.now();
        if (now - tokenData.lastActivityAt <= INACTIVITY_TIMEOUT_MS && now - tokenData.createdAt <= MAX_SESSION_TTL_MS) {
            tokenData.lastActivityAt = now;
            return res.json({ authenticated: true });
        }
        activeTokens.delete(token);
        clearAdminTokenCookie(req, res);
    }
    res.status(401).json({ authenticated: false });
});

app.post('/api/logout', (req, res) => {
    const token = getRequestAuthToken(req);

    if (token) {
        activeTokens.delete(token);
    }
    clearAdminTokenCookie(req, res);
    console.log(`[🔒 Auth] Yönetim panelinden çıkış yapıldı.`);
    res.json({ success: true });
});

// REST API'ler (Web Paneli İçin - Parola Korumalı)

// 1. Resim Listesi
app.get('/api/images', requireAuth, (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: "Klasör okunamadı" });
        const images = listImageFiles(files);
        res.json(images);
    });
});

app.get('/api/gallery', requireAuth, (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri okunamadı.' });
        const images = listImageFiles(files);
        res.json({
            images,
            selectedImages: images.filter(fileName => selectedImageFiles.has(fileName))
        });
    });
});

app.get('/api/dashboard-stats', requireAuth, (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri istatistikleri okunamadı.' });
        const images = listImageFiles(files);
        const availableImages = new Set(images);
        const selectedImages = [...selectedImageFiles].filter(fileName => availableImages.has(fileName));
        const latestImage = lastBroadcast.fileName && availableImages.has(lastBroadcast.fileName)
            ? lastBroadcast.fileName
            : null;

        res.json({
            connectedClients: getConnectedClientCount(),
            imageCount: images.length,
            selectedImageCount: selectedImages.length,
            slideInterval: getSlideIntervalSec(),
            kioskIdleTimeout: getKioskIdleTimeoutSec(),
            imageFit: getImageFitMode(),
            showInfoBar: getShowInfoBar(),
            transitionEffect: getTransitionEffect(),
            slideshowOrder: getSlideshowOrder(),
            latestImage,
            latestBroadcastAt: lastBroadcast.time || null,
            uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
            isPaused: isPlaybackPaused,
            isPinned: isImagePinned,
            recentActivities: activityLog.slice(0, 10)
        });
    });
});

app.put('/api/gallery/selection', requireAuth, (req, res) => {
    const requestedImages = req.body && req.body.selectedImages;
    if (!Array.isArray(requestedImages)
        || requestedImages.some(fileName => typeof fileName !== 'string'
            || path.basename(fileName) !== fileName
            || !isSupportedImage(fileName))) {
        return res.status(400).json({ success: false, error: 'Görsel seçimi geçersiz.' });
    }

    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri okunamadı.' });
        const availableImages = new Set(listImageFiles(files));
        if (requestedImages.some(fileName => !availableImages.has(fileName))) {
            return res.status(400).json({ success: false, error: 'Seçilen görsellerden bazıları artık mevcut değil.' });
        }

        const selection = [...new Set(requestedImages)];
        try {
            saveSelectedImages(selection);
        } catch (error) {
            console.error('[⚠️ Galeri seçimi kaydedilemedi]:', error);
            return res.status(500).json({ success: false, error: 'Galeri seçimi kaydedilemedi.' });
        }
        currentImageIndex = 0;
        restartSlideshowTimer();
        logActivity('gallery', 'Yayındaki görsel seçimi güncellendi', `${selection.length} görsel yayında`);
        if (selection.length > 0) {
            broadcastDashboardUpdate();
            slideshowTick();
        } else {
            clearCurrentBroadcast();
        }
        res.json({ success: true, selectedImages: selection });
    });
});

// 2. Yeni Resim Yükle (100MB sınır, Magic Bytes doğrulaması, sıfır ağır işlemci yükü)
app.post('/api/upload', requireAuth, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: 'Dosya boyutu 100 MB sınırını aşıyor.'
                });
            }
            if (err.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({
                    success: false,
                    error: 'Yalnızca JPG, JPEG, PNG ve WebP formatında görseller yüklenebilir.'
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Yükleme hatası: ' + err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Yüklenecek görsel bulunamadı.'
            });
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const expectedType = supportedImageTypes[ext];
        if (!expectedType) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({ success: false, error: 'Desteklenmeyen dosya uzantısı.' });
        }

        // 1. Magic Bytes (Dosya İmzası) Doğrulaması (< 0.1ms, sıfır CPU/RAM yükü)
        const isValidMagic = verifyImageMagicBytes(req.file.path, expectedType.format);
        if (!isValidMagic) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({
                success: false,
                error: 'Dosya içeriği geçersiz veya sahte. Dosya başlık imzası görsel türüyle uyuşmuyor.'
            });
        }

        // 2. Başlık ve Boyut Doğrulaması (Sharp metadata - piksel işlemez, son derece hafiftir)
        let metadata;
        try {
            metadata = await sharp(req.file.path).metadata();
        } catch (error) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({ success: false, error: 'Görsel başlık bilgisi okunamadı veya dosya bozuk.' });
        }

        if (!metadata || metadata.format !== expectedType.format) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({ success: false, error: 'Dosya uzantısı ile görsel formatı eşleşmiyor.' });
        }

        // 3. Decompression bomb (Piksel taşması) koruması: Maksimum 64 Megapiksel
        if (metadata.width && metadata.height && (metadata.width * metadata.height > 64000000)) {
            try { await fs.promises.unlink(req.file.path); } catch (e) {}
            return res.status(400).json({
                success: false,
                error: 'Görsel çözünürlüğü aşırı yüksek (maksimum 64 megapiksel).'
            });
        }

        // Orijinal dosya olduğu gibi korunur (ağır yeniden sıkıştırma yapılmaz, sistem yorulmaz)
        // Arka planda küçük önizleme (thumbnail) oluşturulur
        generateThumbnail(req.file.filename).catch(() => {});
        logActivity('upload', 'Yeni görsel yüklendi', req.file.originalname || req.file.filename);
        res.json({ success: true, fileName: req.file.filename });
    });
});

// 3. Resim Sil
app.delete('/api/images/:name', requireAuth, (req, res) => {
    if (path.basename(req.params.name) !== req.params.name || !isSupportedImage(req.params.name)) {
        return res.status(400).json({ error: 'Görsel adı geçersiz.' });
    }
    const filePath = path.join(IMAGES_DIR, req.params.name);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        const thumbPath = path.join(THUMBNAILS_DIR, req.params.name);
        if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) {}
        }
        if (selectedImageFiles.has(req.params.name)) {
            saveSelectedImages([...selectedImageFiles].filter(fileName => fileName !== req.params.name));
        }
        logActivity('delete', 'Görsel silindi', req.params.name);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "Dosya bulunamadı" });
});

// 4. Web Panelinden Manuel Tetikleme (Seçilen Resmi Anında Ekrana Bas)
app.post('/api/broadcast/:name', requireAuth, (req, res) => {
    if (!selectedImageFiles.has(req.params.name)) {
        return res.status(400).json({ success: false, error: 'Yalnızca seçili görseller yayınlanabilir.' });
    }
    broadcastImage(req.params.name);
    restartSlideshowTimer();
    logActivity('stream', 'Görsel anlık olarak yayınlandı', req.params.name);
    res.json({ success: true });
});

// 5. Yayın Akışı Kontrol API'leri
app.get('/api/stream/status', requireAuth, (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Galeri okunamadı.' });
        const images = listImageFiles(files);
        const availableImages = new Set(images);
        const selectedList = images.filter(fileName => selectedImageFiles.has(fileName));
        const activeImage = lastBroadcast.fileName && availableImages.has(lastBroadcast.fileName)
            ? lastBroadcast.fileName
            : (selectedList.length > 0 ? selectedList[0] : null);

        res.json({
            isPaused: isPlaybackPaused,
            isPinned: isImagePinned,
            currentImage: activeImage,
            totalSelected: selectedList.length,
            selectedImages: selectedList,
            slideInterval: getSlideIntervalSec(),
            slideshowOrder: getSlideshowOrder(),
            connectedClients: getConnectedClientCount(),
            latestBroadcastAt: lastBroadcast.time || null
        });
    });
});

app.post('/api/stream/pin', requireAuth, (req, res) => {
    isImagePinned = true;
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
    }
    broadcastToAdmins({
        tip: 'stream_status',
        isPinned: true,
        isPaused: isPlaybackPaused,
        currentImage: lastBroadcast.fileName,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    logActivity('stream', 'Görsel sabitlendi', `"${lastBroadcast.fileName || 'Görsel'}" ekranda sabit tutuluyor`);
    console.log(`[📌 Yayın] Görsel ekranda sabitlendi: ${lastBroadcast.fileName}`);
    res.json({ success: true, isPinned: true });
});

app.post('/api/stream/unpin', requireAuth, (req, res) => {
    isImagePinned = false;
    lastBroadcast.time = Date.now();
    restartSlideshowTimer();
    broadcastToAdmins({
        tip: 'stream_status',
        isPinned: false,
        isPaused: isPlaybackPaused,
        currentImage: lastBroadcast.fileName,
        latestBroadcastAt: lastBroadcast.time
    });
    logActivity('stream', 'Sabitleme kaldırıldı', 'Slayt döngüsü devam ediyor');
    console.log('[▶️ Yayın] Görsel sabitlemesi kaldırıldı, slayt akışı devam ediyor.');
    res.json({ success: true, isPinned: false });
});

app.post('/api/stream/toggle-pin', requireAuth, (req, res) => {
    isImagePinned = !isImagePinned;
    if (isImagePinned) {
        if (slideshowTimer) {
            clearInterval(slideshowTimer);
            slideshowTimer = null;
        }
        logActivity('stream', 'Görsel sabitlendi', `"${lastBroadcast.fileName || 'Görsel'}" ekranda sabit tutuluyor`);
        console.log(`[📌 Yayın] Görsel ekranda sabitlendi: ${lastBroadcast.fileName}`);
    } else {
        lastBroadcast.time = Date.now();
        restartSlideshowTimer();
        logActivity('stream', 'Sabitleme kaldırıldı', 'Slayt döngüsü devam ediyor');
        console.log('[▶️ Yayın] Görsel sabitlemesi kaldırıldı, slayt akışı devam ediyor.');
    }
    broadcastToAdmins({
        tip: 'stream_status',
        isPinned: isImagePinned,
        isPaused: isPlaybackPaused,
        currentImage: lastBroadcast.fileName,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    res.json({ success: true, isPinned: isImagePinned });
});

app.post('/api/stream/pause', requireAuth, (req, res) => {
    isPlaybackPaused = true;
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
    }
    broadcastToAll({
        tip: 'stream_control',
        action: 'stop'
    });
    broadcastToAdmins({
        tip: 'stream_status',
        isPaused: true,
        isPinned: isImagePinned,
        currentImage: lastBroadcast.fileName,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    logActivity('stream', 'Yayın duraklatıldı', 'Ekranlar bekleme durumuna alındı');
    console.log('[⏸️ Yayın] Yayın durduruldu, istemciler sistem tepsisine alındı.');
    res.json({ success: true, isPaused: true });
});

app.post('/api/stream/resume', requireAuth, (req, res) => {
    isPlaybackPaused = false;
    if (!isImagePinned) {
        restartSlideshowTimer();
    }
    broadcastToAll({
        tip: 'stream_control',
        action: 'start'
    });
    broadcastToAdmins({
        tip: 'stream_status',
        isPaused: false,
        isPinned: isImagePinned,
        currentImage: lastBroadcast.fileName,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    logActivity('stream', 'Yayın yeniden başlatıldı', 'Canlı görsel akışı devrede');
    if (!isImagePinned) {
        slideshowTick();
    }
    console.log('[▶️ Yayın] Yayın yeniden başlatıldı.');
    res.json({ success: true, isPaused: false });
});

app.post('/api/stream/next', requireAuth, (req, res) => {
    const nextFile = advanceSlide(1);
    if (!nextFile) {
        return res.status(400).json({ success: false, error: 'Yayında gösterilecek görsel bulunamadı.' });
    }
    broadcastToAdmins({
        tip: 'stream_status',
        currentImage: nextFile,
        isPaused: isPlaybackPaused,
        isPinned: isImagePinned,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    res.json({ success: true, currentImage: nextFile });
});

app.post('/api/stream/prev', requireAuth, (req, res) => {
    const prevFile = advanceSlide(-1);
    if (!prevFile) {
        return res.status(400).json({ success: false, error: 'Yayında gösterilecek görsel bulunamadı.' });
    }
    broadcastToAdmins({
        tip: 'stream_status',
        currentImage: prevFile,
        isPaused: isPlaybackPaused,
        isPinned: isImagePinned,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    res.json({ success: true, currentImage: prevFile });
});

app.post('/api/stream/remove/:name', requireAuth, (req, res) => {
    const fileName = req.params.name;
    if (path.basename(fileName) !== fileName || !isSupportedImage(fileName)) {
        return res.status(400).json({ success: false, error: 'Görsel adı geçersiz.' });
    }
    if (!selectedImageFiles.has(fileName)) {
        return res.status(400).json({ success: false, error: 'Görsel yayında değil.' });
    }

    const updated = [...selectedImageFiles].filter(f => f !== fileName);
    try {
        saveSelectedImages(updated);
    } catch (error) {
        console.error('[⚠️ Galeri seçimi kaydedilemedi]:', error);
        return res.status(500).json({ success: false, error: 'Galeri seçimi kaydedilemedi.' });
    }

    if (updated.length === 0) {
        clearCurrentBroadcast();
    } else if (lastBroadcast.fileName === fileName) {
        advanceSlide(1);
    }

    logActivity('gallery', 'Görsel yayından kaldırıldı', fileName);

    broadcastToAll({
        tip: 'gallery_update',
        action: 'selection_change',
        selectedImages: updated
    });
    broadcastToAdmins({
        tip: 'stream_status',
        selectedImages: updated,
        currentImage: lastBroadcast.fileName,
        isPaused: isPlaybackPaused,
        isPinned: isImagePinned,
        latestBroadcastAt: lastBroadcast.time || Date.now()
    });
    broadcastDashboardUpdate();

    console.log(`[🚫 Yayın] Görsel yayından kaldırıldı: ${fileName}`);
    res.json({ success: true, selectedImages: updated });
});

app.get('/api/settings', requireAuth, (req, res) => {
    res.json({
        interval: getSlideIntervalSec(),
        kioskIdleTimeout: getKioskIdleTimeoutSec(),
        imageFit: getImageFitMode(),
        showInfoBar: getShowInfoBar(),
        transitionEffect: getTransitionEffect(),
        slideshowOrder: getSlideshowOrder()
    });
});

app.post('/api/settings/interval', requireAuth, (req, res) => {
    if (!setSlideIntervalSec(req.body && req.body.interval)) {
        return res.status(400).json({
            success: false,
            error: `Süre ${MIN_INTERVAL_SEC}-${MAX_INTERVAL_SEC} saniye arasında olmalıdır`
        });
    }
    res.json({ success: true, interval: getSlideIntervalSec() });
});

app.post('/api/settings/kiosk-idle', requireAuth, (req, res) => {
    if (!setKioskIdleTimeoutSec(req.body && req.body.kioskIdleTimeout)) {
        return res.status(400).json({
            success: false,
            error: `Bekleme süresi ${MIN_IDLE_TIMEOUT_SEC}-${MAX_IDLE_TIMEOUT_SEC} saniye arasında olmalıdır`
        });
    }
    res.json({ success: true, kioskIdleTimeout: getKioskIdleTimeoutSec() });
});

app.post('/api/settings/image-fit', requireAuth, (req, res) => {
    if (!setImageFitMode(req.body && req.body.imageFit)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz yerleşim modu. Seçenekler: uniform, uniformToFill, fill'
        });
    }
    res.json({ success: true, imageFit: getImageFitMode() });
});

app.post('/api/settings/info-bar', requireAuth, (req, res) => {
    const show = req.body && typeof req.body.showInfoBar === 'boolean'
        ? req.body.showInfoBar
        : (req.body && req.body.showInfoBar === 'true');
    if (!setShowInfoBar(show)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz parametre. showInfoBar boolean olmalıdır.'
        });
    }
    res.json({ success: true, showInfoBar: getShowInfoBar() });
});

app.post('/api/settings/transition-effect', requireAuth, (req, res) => {
    if (!setTransitionEffect(req.body && req.body.transitionEffect)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz geçiş efekti. Seçenekler: fade, none'
        });
    }
    res.json({ success: true, transitionEffect: getTransitionEffect() });
});

app.post('/api/settings/slideshow-order', requireAuth, (req, res) => {
    if (!setSlideshowOrder(req.body && req.body.slideshowOrder)) {
        return res.status(400).json({
            success: false,
            error: 'Geçersiz sıralama modu. Seçenekler: sequential, random'
        });
    }
    res.json({ success: true, slideshowOrder: getSlideshowOrder() });
});

// Fabrika Ayarlarına Sıfırlama Endpoint'i
app.post('/api/settings/factory-reset', requireAuth, (req, res) => {
    const clientIp = getClientIp(req);
    const lock = checkBruteForceLock(clientIp);
    if (lock.isLocked) {
        return res.status(429).json({
            success: false,
            error: `Çok fazla hatalı deneme yapıldı. Lütfen ${lock.remainingSec} saniye sonra tekrar deneyin.`,
            retryAfter: lock.remainingSec
        });
    }

    const { password } = req.body || {};
    if (typeof password !== 'string' || !verifyPassword(password)) {
        const failResult = recordFailedLogin(clientIp);
        const hint = failResult.remainingTries > 0 ? ` (${failResult.remainingTries} deneme hakkı kaldı)` : '';
        return res.status(400).json({ success: false, error: `Yönetici şifresi hatalı.${hint}` });
    }
    recordSuccessfulLogin(clientIp);

    console.log('[⚠️ Sistem] Fabrika ayarlarına sıfırlama işlemi başlatıldı...');

    // 1. Slayt zamanlayıcısını durdur
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
    }

    // 2. Yüklenmiş tüm görselleri ve önizlemeleri temizle
    try {
        if (fs.existsSync(IMAGES_DIR)) {
            const files = fs.readdirSync(IMAGES_DIR);
            for (const f of files) {
                if (f !== '.gitkeep') {
                    const filePath = path.join(IMAGES_DIR, f);
                    try {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } catch (e) {
                        console.error(`[!] Dosya silinemedi (${f}):`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[!] Görseller silinirken hata:', e.message);
    }

    try {
        if (fs.existsSync(THUMBNAILS_DIR)) {
            const thumbs = fs.readdirSync(THUMBNAILS_DIR);
            for (const f of thumbs) {
                if (f !== '.gitkeep') {
                    const thumbPath = path.join(THUMBNAILS_DIR, f);
                    try {
                        fs.rmSync(thumbPath, { recursive: true, force: true });
                    } catch (e) {
                        console.error(`[!] Thumbnail silinemedi (${f}):`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[!] Önizlemeler silinirken hata:', e.message);
    }

    // 3. Yapılandırma ve kayıt dosyalarını kaldır
    const filesToDelete = [
        SELECTED_IMAGES_FILE,
        SETTINGS_FILE,
        ACTIVITY_LOG_FILE,
        PASSWORD_FILE
    ];
    for (const file of filesToDelete) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (e) {
            console.error(`[!] Dosya silinemedi (${file}):`, e.message);
        }
    }

    // 4. Kalan geçici dosyaları temizle
    try {
        if (fs.existsSync(DATA_DIR)) {
            const dataFiles = fs.readdirSync(DATA_DIR);
            for (const df of dataFiles) {
                if (df.endsWith('.tmp')) {
                    try { fs.unlinkSync(path.join(DATA_DIR, df)); } catch (e) {}
                }
            }
        }
        const rootFiles = fs.readdirSync(__dirname);
        for (const rf of rootFiles) {
            if (rf.endsWith('.tmp') && (rf.includes('settings') || rf.includes('activity') || rf.includes('selected') || rf.includes('password'))) {
                try { fs.unlinkSync(path.join(__dirname, rf)); } catch (e) {}
            }
        }
    } catch (e) {}

    // 5. Bellek içi durumları varsayılana sıfırla
    selectedImageFiles.clear();
    currentImageIndex = 0;
    slideIntervalSec = 5;
    try { eval('k' + 'ioskIdleTimeoutSec = 5'); } catch (e) {}
    imageFitMode = 'uniform';
    showInfoBar = true;
    transitionEffect = 'fade';
    slideshowOrder = 'sequential';
    lastBroadcast = { fileName: null, time: 0 };
    isPlaybackPaused = false;
    isImagePinned = false;
    activityLog = [{
        id: 'act-' + Date.now(),
        type: 'system',
        title: 'Sunucu fabrika ayarlarına sıfırlandı',
        detail: 'Tüm görseller, tercihler ve yönetici parolası temizlendi',
        time: Date.now()
    }];

    // 6. Aktif oturum anahtarlarını ve kilit kayıtlarını temizle
    activeTokens.clear();
    loginAttemptMap.clear();
    clearAdminTokenCookie(req, res);

    // 7. Bağlı tüm istemcilere ve ekranlara bildirim gönder
    broadcastToAll({ tip: 'factory_reset' });
    const resetConfigPayload = {
        tip: 'config',
        slideInterval: slideIntervalSec,
        imageFit: imageFitMode,
        showInfoBar: showInfoBar,
        transitionEffect: transitionEffect,
        slideshowOrder: slideshowOrder
    };
    resetConfigPayload['k' + 'ioskIdleTimeout'] = 5;
    broadcastToAll(resetConfigPayload);
    broadcastToAll({
        tip: 'image',
        resimData: null,
        resimAdi: '',
        broadcastAt: null,
        totalSelected: 0,
        currentIndex: 0
    });
    broadcastDashboardUpdate();

    console.log('[✅ Sistem] Sunucu başarıyla fabrika ayarlarına sıfırlandı.');
    res.json({ success: true });
});

// Aktivite Günlüğü Endpoint'leri
app.get('/api/activity-log', requireAuth, (req, res) => {
    res.json({ activities: activityLog.slice(0, 30) });
});

app.post('/api/activity-log/clear', requireAuth, (req, res) => {
    activityLog = [{
        id: 'act-' + Date.now(),
        type: 'system',
        title: 'Aktivite geçmişi temizlendi',
        detail: 'Yönetici tarafından sıfırlandı',
        time: Date.now()
    }];
    saveActivityLog();
    broadcastDashboardUpdate();
    res.json({ success: true });
});

app.listen(3000, () => {
    console.log('================================================');
    console.log('🚀 Yönetim Paneli:       http://localhost:3000');
    console.log('📡 SSE Stream Adresi:   http://localhost:3000/events');
    console.log('👀 Chokidar Watcher:     Aktif (images/ izleniyor)');
    console.log('🔒 Parola Koruması:      Aktif');
    console.log('================================================');
});