const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
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

// REST API'ler (Web Paneli İçin)

// 1. Resim Listesi
app.get('/api/images', (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: "Klasör okunamadı" });
        const images = listImageFiles(files);
        res.json(images);
    });
});

// 2. Yeni Resim Yükle
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Dosya seçilmedi" });
    
    // Yüklenen resmi anında ekrana bas
    broadcastImage(req.file.filename);
    restartSlideshowTimer();
    res.json({ success: true, fileName: req.file.filename });
});

// 3. Resim Sil
app.delete('/api/images/:name', (req, res) => {
    const filePath = path.join(IMAGES_DIR, req.params.name);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "Dosya bulunamadı" });
});

// 4. Web Panelinden Manuel Tetikleme (Seçilen Resmi Anında Ekrana Bas)
app.post('/api/broadcast/:name', (req, res) => {
    broadcastImage(req.params.name);
    restartSlideshowTimer();
    res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
    res.json({ interval: getSlideIntervalSec() });
});

app.post('/api/settings/interval', (req, res) => {
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
    console.log('================================================');
});