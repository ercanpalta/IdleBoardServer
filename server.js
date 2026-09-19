const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// Statik veya önbellek resim tutucu (Disk okumasını optimize etmek için)
const IMAGE_PATH = path.join(__dirname, 'test.jpg');

app.get('/events', (req, res) => {
    // SSE Başlıkları
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log(`[+] Windows Kiosk istemcisi bağlandı. (${new Date().toLocaleTimeString()})`);

    // İlk bağlantı anında istemciye başarılı bağlantı bildirimi gönder
    res.write(`data: ${JSON.stringify({ mesaj: "SSE Bağlantısı Kuruldu", tip: "init" })}\n\n`);

    // Her 4 saniyede bir resmi Base64 yaparak gönderelim
    const intervalId = setInterval(() => {
        fs.readFile(IMAGE_PATH, (err, data) => {
            if (err) {
                console.error("Resim okuma hatası:", err.message);
                // Resim bulunamazsa istemciye hata tipi gönder
                res.write(`data: ${JSON.stringify({ hata: "Resim bulunamadı", tip: "error" })}\n\n`);
                return;
            }

            // Resmi Base64 string'e çeviriyoruz
            const base64Image = data.toString('base64');

            const payload = {
                tip: "image",
                zaman: new Date().toLocaleTimeString(),
                mesaj: "Yeni görsel aktarıldı",
                resimData: base64Image
            };

            // SSE Formatında gönderim
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
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