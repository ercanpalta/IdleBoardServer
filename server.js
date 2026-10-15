const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const chokidar = require('chokidar');
const sharp = require('sharp');

const app = express();
app.use(cors());
app.use(express.json());

// Statik Web Paneli Dosyaları
app.use(express.static(path.join(__dirname, 'public')));

const IMAGES_DIR = path.join(__dirname, 'images');
const THUMBNAILS_DIR = path.join(__dirname, 'thumbnails');
const SELECTED_IMAGES_FILE = path.join(__dirname, 'selected-images.json');
const SETTINGS_FILE = path.join(__dirname, 'server-settings.json');
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}
if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
}

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

// Kimlik Doğrulama (Auth) Yapılandırması
const PASSWORD_FILE = path.join(__dirname, 'admin-password.json');
const MIN_PASSWORD_LENGTH = 6;
const activeTokens = new Set();

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

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
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer ')) 
        ? authHeader.slice(7) 
        : req.headers['x-admin-token'];

    if (!token || !activeTokens.has(token)) {
        return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
    }
    next();
}

// Multer Dosya Yükleme Ayarları
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
        const ext = path.extname(file.originalname);
        cb(null, `img-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const type = supportedImageTypes[path.extname(file.originalname).toLowerCase()];
        cb(null, Boolean(type && file.mimetype === type.mimeType));
    }
});

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

let slideshowTimer = null;
let slideshowTickInFlight = false;
let lastBroadcast = { fileName: null, time: 0 };
let isPlaybackPaused = false;

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
            showInfoBar: showInfoBar
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
    if (lastBroadcast.fileName) {
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

    if (!isPlaybackPaused) {
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
ensureThumbnails();

function slideshowTick() {
    if (isPlaybackPaused || clients.length === 0 || slideshowTickInFlight) return;

    slideshowTickInFlight = true;
    fs.readdir(IMAGES_DIR, (err, files) => {
        slideshowTickInFlight = false;
        if (err || !files) return;

        const imageFiles = listImageFiles(files).filter(fileName => selectedImageFiles.has(fileName));
        if (imageFiles.length === 0) return;

        if (currentImageIndex >= imageFiles.length) {
            currentImageIndex = 0;
        }

        const selectedFile = imageFiles[currentImageIndex];
        broadcastImage(selectedFile);
        currentImageIndex++;
    });
}

function restartSlideshowTimer() {
    if (slideshowTimer) {
        clearInterval(slideshowTimer);
        slideshowTimer = null;
    }
    if (isPlaybackPaused) return;
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
    console.log(`[i] Kiosk açılma süresi güncellendi: ${kioskIdleTimeoutSec}sn`);
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
    return true;
}

// SSE Endpoint (C# WPF İstemcisinin ve Web Panelinin Bağlandığı Adres)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const clientId = crypto.randomUUID();
    const isAdmin = req.query.source === 'admin';
    const newClient = { id: clientId, res, isAdmin };
    clients.push(newClient);

    if (!isAdmin) {
        broadcastToAdmins({ tip: 'client_count', connectedClients: getConnectedClientCount() });
    }
    console.log(`[+] Yeni istemci bağlandı. (ID: ${clientId}, Toplam: ${getConnectedClientCount()})`);

    res.write(`data: ${JSON.stringify({
        tip: 'init',
        mesaj: 'Bağlantı Başarılı',
        slideInterval: getSlideIntervalSec(),
        kioskIdleTimeout: getKioskIdleTimeoutSec(),
        imageFit: getImageFitMode(),
        showInfoBar: getShowInfoBar(),
        isPaused: isPlaybackPaused
    })}\n\n`);

    if (isPlaybackPaused && !isAdmin) {
        res.write(`data: ${JSON.stringify({
            tip: 'stream_control',
            action: 'stop'
        })}\n\n`);
    } else if (!isPlaybackPaused && clients.filter(c => !c.isAdmin).length === 1) {
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
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
            success: false,
            error: `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`
        });
    }
    if (password !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Parola tekrarı eşleşmiyor.' });
    }

    savePassword(password);
    res.json({ success: true });
});

app.post('/api/auth/password', requireAuth, (req, res) => {
    const { currentPassword, newPassword, passwordConfirmation } = req.body || {};
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword)) {
        return res.status(400).json({ success: false, error: 'Mevcut parola hatalı.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
            success: false,
            error: `Yeni parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`
        });
    }
    if (newPassword !== passwordConfirmation) {
        return res.status(400).json({ success: false, error: 'Yeni parola tekrarı eşleşmiyor.' });
    }
    if (newPassword === currentPassword) {
        return res.status(400).json({ success: false, error: 'Yeni parola mevcut paroladan farklı olmalıdır.' });
    }

    savePassword(newPassword);
    activeTokens.clear();
    const token = generateToken();
    activeTokens.add(token);
    res.json({ success: true, token });
});

app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (!isPasswordConfigured()) {
        return res.status(428).json({ success: false, error: 'Önce yönetici parolasını belirleyin.' });
    }
    if (typeof password !== 'string' || !verifyPassword(password)) {
        return res.status(401).json({ success: false, error: 'Hatalı parola!' });
    }

    const token = generateToken();
    activeTokens.add(token);
    console.log(`[🔐 Auth] Yönetim paneline başarılı giriş yapıldı.`);
    res.json({ success: true, token });
});

app.get('/api/auth/check', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer ')) 
        ? authHeader.slice(7) 
        : req.headers['x-admin-token'];

    if (token && activeTokens.has(token)) {
        return res.json({ authenticated: true });
    }
    res.status(401).json({ authenticated: false });
});

app.post('/api/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.startsWith('Bearer ')) 
        ? authHeader.slice(7) 
        : req.headers['x-admin-token'];

    if (token) {
        activeTokens.delete(token);
        console.log(`[🔒 Auth] Yönetim panelinden çıkış yapıldı.`);
    }
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
            latestImage,
            latestBroadcastAt: lastBroadcast.time || null,
            uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
            isPaused: isPlaybackPaused
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
        if (selection.length > 0) {
            broadcastDashboardUpdate();
            slideshowTick();
        } else {
            clearCurrentBroadcast();
        }
        res.json({ success: true, selectedImages: selection });
    });
});

// 2. Yeni Resim Yükle
app.post('/api/upload', requireAuth, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            error: 'Yalnızca JPG, JPEG, PNG ve WebP görseller yüklenebilir.'
        });
    }

    const expectedType = supportedImageTypes[path.extname(req.file.originalname).toLowerCase()];
    let metadata;
    try {
        metadata = await sharp(req.file.path).metadata();
    } catch (error) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ error: 'Dosya geçerli bir görsel değil.' });
    }

    if (!expectedType || metadata.format !== expectedType.format) {
        await fs.promises.unlink(req.file.path);
        return res.status(400).json({ error: 'Dosya uzantısı ile görsel içeriği eşleşmiyor.' });
    }

    generateThumbnail(req.file.filename).catch(() => {});
    res.json({ success: true, fileName: req.file.filename });
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
            currentImage: activeImage,
            totalSelected: selectedList.length,
            selectedImages: selectedList,
            slideInterval: getSlideIntervalSec(),
            connectedClients: getConnectedClientCount()
        });
    });
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
        currentImage: lastBroadcast.fileName
    });
    broadcastDashboardUpdate();
    console.log('[⏸️ Yayın] Yayın durduruldu, istemciler sistem tepsisine alındı.');
    res.json({ success: true, isPaused: true });
});

app.post('/api/stream/resume', requireAuth, (req, res) => {
    isPlaybackPaused = false;
    restartSlideshowTimer();
    broadcastToAll({
        tip: 'stream_control',
        action: 'start'
    });
    broadcastToAdmins({
        tip: 'stream_status',
        isPaused: false,
        currentImage: lastBroadcast.fileName
    });
    broadcastDashboardUpdate();
    slideshowTick();
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
        isPaused: isPlaybackPaused
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
        isPaused: isPlaybackPaused
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

    broadcastToAll({
        tip: 'gallery_update',
        action: 'selection_change',
        selectedImages: updated
    });
    broadcastToAdmins({
        tip: 'stream_status',
        selectedImages: updated,
        currentImage: lastBroadcast.fileName,
        isPaused: isPlaybackPaused
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
        showInfoBar: getShowInfoBar()
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
            error: `Kiosk süresi ${MIN_IDLE_TIMEOUT_SEC}-${MAX_IDLE_TIMEOUT_SEC} saniye arasında olmalıdır`
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

app.listen(3000, () => {
    console.log('================================================');
    console.log('🚀 Kiosk Yönetim Paneli: http://localhost:3000');
    console.log('📡 SSE Stream Adresi:   http://localhost:3000/events');
    console.log('👀 Chokidar Watcher:     Aktif (images/ izleniyor)');
    console.log('🔒 Parola Koruması:      Aktif');
    console.log('================================================');
});