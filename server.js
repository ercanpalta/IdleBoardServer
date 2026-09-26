const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// Statik Web Paneli Dosyaları
app.use(express.static(path.join(__dirname, 'public')));

const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

app.use('/images', express.static(IMAGES_DIR)); // <--- GÖRSELLER İÇİN BU SATIR EKLENDİ

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

// SSE Endpoint (C# WPF İstemcisinin Bağlandığı Adres)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    console.log(`[+] Windows Kiosk istemcisi bağlandı. (ID: ${clientId})`);

    // İlk bağlantıda bağlı olduğunu teyit et
    res.write(`data: ${JSON.stringify({ tip: "init", mesaj: "Bağlantı Başarılı" })}\n\n`);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
        console.log(`[-] Windows Kiosk istemcisi ayrıldı. (ID: ${clientId})`);
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
            tip: "image",
            dosyaAdi: fileName,
            zaman: new Date().toLocaleTimeString(),
            resimData: base64Image
        };

        clients.forEach(c => c.res.write(`data: ${JSON.stringify(payload)}\n\n`));
        console.log(`[>] Slayt Yayını Yapıldı: ${fileName} (${clients.length} İstemci)`);
    });
}

/**
 * Otomatik Slayt Zamanlayıcısı (Her 4 saniyede bir sıradaki resmi basar)
 */
setInterval(() => {
    if (clients.length === 0) return; // İstemci yoksa işlem yapma

    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err || !files) return;

        const imageFiles = files.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
        }).sort();

        if (imageFiles.length === 0) return;

        if (currentImageIndex >= imageFiles.length) {
            currentImageIndex = 0;
        }

        const selectedFile = imageFiles[currentImageIndex];
        broadcastImage(selectedFile);

        currentImageIndex++;
    });
}, 4000);

// REST API'ler (Web Paneli İçin)

// 1. Resim Listesi
app.get('/api/images', (req, res) => {
    fs.readdir(IMAGES_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: "Klasör okunamadı" });
        const images = files.filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase()));
        res.json(images);
    });
});

// 2. Yeni Resim Yükle
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Dosya seçilmedi" });
    
    // Yüklenen resmi anında ekrana bas
    broadcastImage(req.file.filename);
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
    res.json({ success: true });
});

app.listen(3000, () => {
    console.log('================================================');
    console.log('🚀 Kiosk Yönetim Paneli: http://localhost:3000');
    console.log('📡 SSE Stream Adresi:   http://localhost:3000/events');
    console.log('================================================');
});