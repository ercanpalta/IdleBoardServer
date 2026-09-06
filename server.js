const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log('Windows istemcisi bağlandı.');

    // Her 4 saniyede bir resmi Base64 yapıp gönderelim
    const intervalId = setInterval(() => {
        const imagePath = path.join(__dirname, 'test.jpg'); // Klasördeki resim dosyası

        fs.readFile(imagePath, (err, data) => {
            if (err) {
                console.error("Resim okuma hatası:", err.message);
                return;
            }

            // Resmi Base64 string'e çeviriyoruz
            const base64Image = data.toString('base64');

            const payload = {
                zaman: new Date().toLocaleTimeString(),
                mesaj: "Yeni görsel aktarıldı",
                resimData: base64Image
            };

            // SSE Formatında gönderim
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        });
    }, 4000);

    req.on('close', () => {
        clearInterval(intervalId);
        console.log('İstemci ayrıldı.');
        res.end();
    });
});

app.listen(3000, () => {
    console.log('SSE Resim Sunucusu http://localhost:3000/events adresinde çalışıyor.');
});