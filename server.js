const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// Resimlerin tutulduğu klasör yolu
const IMAGES_DIR = path.join(__dirname, 'images');

// Klasör yoksa otomatik oluştur
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR);
    console.log('[!] "images" klasörü bulunamadı, otomatik oluşturuldu.');
}

app.get('/events', (req, res) => {
    // SSE Başlıkları
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log(`[+] Windows Kiosk istemcisi bağlandı. (${new Date().toLocaleTimeString()})`);

    // İlk bağlantı anında istemciye başarılı bağlantı bildirimi gönder
    res.write(`data: ${JSON.stringify({ mesaj: "SSE Bağlantısı Kuruldu", tip: "init" })}\n\n`);

    let currentImageIndex = 0;
    
    // Her 4 saniyede bir 'images' klasöründeki sıradaki resmi gönder
    const intervalId = setInterval(() => {
        // Klasördeki dosyaları oku
        fs.readdir(IMAGES_DIR, (err, files) => {
            if (err) {
                console.error("Klasör okuma hatası:", err.message);
                return;
            }

            // Sadece resim formatındaki dosyaları filtrele
            const imageFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
            }).sort(); // Alfabetik sırala

            // Klasörde resim yoksa uyarı gönder
            if (imageFiles.length === 0) {
                const emptyPayload = {
                    tip: "warning",
                    zaman: new Date().toLocaleTimeString(),
                    mesaj: "images klasöründe gösterilecek resim bulunamadı."
                };
                res.write(`data: ${JSON.stringify(emptyPayload)}\n\n`);
                return;
            }

            // Liste sonuna geldiysek başa dön (Döngüsel Playlist)
            if (currentImageIndex >= imageFiles.length) {
                currentImageIndex = 0;
            }

            const selectedFileName = imageFiles[currentImageIndex];
            const imagePath = path.join(IMAGES_DIR, selectedFileName);

            // Seçilen resmi oku ve Base64'e çevir
            fs.readFile(imagePath, (readErr, data) => {
                if (readErr) {
                    console.error(`Resim okuma hatası (${selectedFileName}):`, readErr.message);
                    return;
                }

                const base64Image = data.toString('base64');

                const payload = {
                    tip: "image",
                    dosyaAdi: selectedFileName,
                    zaman: new Date().toLocaleTimeString(),
                    mesaj: "Yeni görsel aktarıldı",
                    resimData: base64Image
                };

                // SSE formatında Kiosk'a gönder
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
                console.log(`[>] Yayınlandı [${currentImageIndex + 1}/${imageFiles.length}]: ${selectedFileName}`);

                // Bir sonraki resme geç
                currentImageIndex++;
            });
        });
    }, 4000);

    // İstemci bağlantıyı kestiğinde zamanlayıcıyı temizle
    req.on('close', () => {
        clearInterval(intervalId);
        console.log(`[-] Windows Kiosk istemcisi ayrıldı. (${new Date().toLocaleTimeString()})`);
    });
});

app.listen(3000, () => {
    console.log('================================================');
    console.log('🚀 Kiosk SSE Resim Sunucusu Çalışıyor');
    console.log('📡 Stream Adresi: http://localhost:3000/events');
    console.log('================================================');
});