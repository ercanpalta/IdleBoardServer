# IdleBoard Server

Node.js ve Express tabanlı, Server-Sent Events (SSE) ile istemci cihazlara görsel yayını yapan ve web yönetim paneli sunan sunucu uygulaması.

## 🚀 Özellikler

- **Canlı Görsel Yayını (SSE):** Bağlı istemci ekranlara gerçek zamanlı Server-Sent Events üzerinden dinamik görsel aktarımı.
- **Web Yönetim Paneli:** Görsel yükleme, galeri yönetimi, anlık yayına alma, yayın duraklatma ve sabitleme kontrolleri.
- **Dinamik Slayt Gösterisi:** Yapılandırılabilir geçiş süreleri (interval), slayt sırası ve geçiş efektleri.
- **Güçlü Güvenlik Katmanı:**
  - Content Security Policy (CSP) & Permissions Policy
  - Kaba kuvvet (Brute-force) koruması ve hız sınırlama (Rate limiting)
  - HttpOnly, SameSite korumalı oturum çerezleri
  - Parola politikası, scrypt karma ve güç ölçer
  - Çapraz kaynak (Origin/Referer) koruması ve yerel ağ uyumlu CORS
  - 100 MB yükleme sınırı, dosya imzası (Magic Bytes) doğrulama

## 📦 Kurulum ve Çalıştırma

Gereksinim: Node.js (v18+)

```bash
# Bağımlılıkları yükleyin
npm install

# Sunucuyu başlatın (varsayılan port: 3000)
npm start
```

Sunucu başladığında tarayıcınızdan `http://localhost:3000` adresine giderek yönetim paneline erişebilirsiniz.
