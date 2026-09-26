const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const chokidar = require('chokidar');

const app = express();
app.use(cors());
app.use(express.json());

// Statik Web Paneli Dosyaları
app.use(express.static(path.join(__dirname, 'public')));

const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

app.use('/images', express.static(IMAGES_DIR));

// Kimlik Doğrulama (Auth) Yapılandırması
const PASSWORD_FILE = path.join(__dirname, 'admin-password.json');
const MIN_PASSWORD_LENGTH = 6;
const activeTokens = new Set();

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function readPasswordHash() {
    if (process.env.ADMIN_PASSWORD) {
        return { type: 'plain', value: process.env.ADMIN_PASSWORD };
    }

    if (!fs.existsSync(PASSWORD_FILE)) {
        return null;
    }

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
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `img-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ storage });

// Aktif SSE İstemcileri
let clients = [];
let currentImageIndex = 0;

const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 300;
let slideIntervalSec = 5;
let slideshowTimer = null;
let slideshowTickInFlight = false;
let lastBroadcast = { fileName: null, time: 0 };

function getSlideIntervalSec() {
    return slideIntervalSec;
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

function slideshowTick() {
    if (clients.length === 0 || slideshowTickInFlight) return;

    slideshowTickInFlight = true;
    fs.readdir(IMAGES_DIR, (err, files) => {
        slideshowTickInFlight = false;
        if (err || !files) return;

        const imageFiles = listImageFiles(files);
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
    slideshowTimer = setInterval(slideshowTick, slideIntervalSec * 1000);
}

function setSlideIntervalSec(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < MIN_INTERVAL_SEC || value > MAX_INTERVAL_SEC) {
        return false;
    }
    slideIntervalSec = Math.round(value);
    restartSlideshowTimer();
    broadcastToAll({
        tip: 'config',
        slideInterval: slideIntervalSec
    });
    console.log(`[i] Slayt süresi güncellendi: ${slideIntervalSec}sn`);
    return true;
}

// SSE Endpoint (C# WPF İstemcisinin ve Web Panelinin Bağlandığı Adres)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    console.log(`[+] Yeni istemci bağlandı. (ID: ${clientId}, Toplam: ${clients.length})`);

    res.write(`data: ${JSON.stringify({
        tip: 'init',
        mesaj: 'Bağlantı Başarılı',
        slideInterval: getSlideIntervalSec()
    })}\n\n`);

    // İlk istemci bağlandığında hemen ilk görseli yayınla (beklemeyi önle)
    if (clients.length === 1) {
        slideshowTick();
    }

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
        console.log(`[-] İstemci ayrıldı. (ID: ${clientId}, Kalan: ${clients.length})`);
    });
});

// Belirtilen Resmi Tüm Bağlı İstemcilere Gönderen Fonksiyon
function broadcastImage(fileName) {
    if (clients.length === 0) return;

    const filePath = path.join(IMAGES_DIR, fileName);
    if (!fs.existsSync(filePath)) return;

    fs.readFile(filePath, (err, data) => {
        if (err) return;

        const base64Image = data.toString('base64');
        const payload = {
            tip: 'image',
            dosyaAdi: fileName,
            zaman: new Date().toLocaleTimeString(),
            slideInterval: getSlideIntervalSec(),
            resimData: base64Image
        };

        lastBroadcast = { fileName, time: Date.now() };
        broadcastToAll(payload);
        console.log(`[>] Slayt Yayını Yapıldı: ${fileName} (${clients.length} İstemci)`);
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

        // Web paneli galerisini anında güncellemesi için bilgilendir
        broadcastToAll({
            tip: 'gallery_update',
            action: 'add',
            fileName
        });

        // Eğer son 1.5 saniye içinde aynı dosya web upload üzerinden basılmadıysa, hemen yayına al
        if (lastBroadcast.fileName !== fileName || (Date.now() - lastBroadcast.time > 1500)) {
            broadcastImage(fileName);
            restartSlideshowTimer();
        }
    })
    .on('unlink', (filePath) => {
        if (!isSupportedImage(filePath)) return;
        const fileName = path.basename(filePath);
        console.log(`[🗑️ Watcher] Klasörden görsel silindi: ${fileName}`);

        // Web paneli galerisini anında güncellemesi için bilgilendir
        broadcastToAll({
            tip: 'gallery_update',
            action: 'unlink',
            fileName
        });

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

// 2. Yeni Resim Yükle
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Dosya seçilmedi" });
    
    // Yüklenen resmi anında ekrana bas
    broadcastImage(req.file.filename);
    restartSlideshowTimer();
    res.json({ success: true, fileName: req.file.filename });
});

// 3. Resim Sil
app.delete('/api/images/:name', requireAuth, (req, res) => {
    const filePath = path.join(IMAGES_DIR, req.params.name);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "Dosya bulunamadı" });
});

// 4. Web Panelinden Manuel Tetikleme (Seçilen Resmi Anında Ekrana Bas)
app.post('/api/broadcast/:name', requireAuth, (req, res) => {
    broadcastImage(req.params.name);
    restartSlideshowTimer();
    res.json({ success: true });
});

app.get('/api/settings', requireAuth, (req, res) => {
    res.json({ interval: getSlideIntervalSec() });
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

app.listen(3000, () => {
    console.log('================================================');
    console.log('🚀 Kiosk Yönetim Paneli: http://localhost:3000');
    console.log('📡 SSE Stream Adresi:   http://localhost:3000/events');
    console.log('👀 Chokidar Watcher:     Aktif (images/ izleniyor)');
    console.log('🔒 Parola Koruması:      Aktif');
    console.log('================================================');
});