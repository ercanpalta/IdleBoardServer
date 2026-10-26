# IdleBoard Server Kurulum Paketi (Installer)

Bu dizin, son kullanıcıların sunucuyu tek tıklamayla sisteme kurabilmesi için hazırlanan Inno Setup yapılandırmasını ve otomatik paketleme betiklerini içerir.

## Kurulum Özellikleri ve Kuralları

1. **Gömülü Node.js (Node.js Kurulumu Gerektirmeyen Yapı):**
   - Sunucu paketi içerisinde taşınabilir `node.exe` çalışma ortamı gömülüdür.
   - Son kullanıcının bilgisayarına harici olarak Node.js kurmasına gerek yoktur.

2. **Windows Arka Plan Servisi Olarak Çalışma (Mecburi / Gizli):**
   - Kurulum ekranında kullanıcıya bir seçenek olarak **gösterilmez**.
   - Üçüncü parti servis aracı kullanılmadan, doğrudan Windows'un yerel **Görev Zamanlayıcısı (Task Scheduler - `schtasks`)** altyapısıyla `SYSTEM` hesabı altında arka plan görevi olarak kaydedilir.
   - Bilgisayar her açıldığında herhangi bir CMD / PowerShell penceresi açılmadan arka planda sessizce yayına başlar.

3. **Port 3000 Güvenlik Duvarı (Firewall) İzni:**
   - İstemci ekranların sunucuya kesintisiz bağlanabilmesi için Windows Güvenlik Duvarı'na Port 3000 TCP gelen bağlantı kuralı (`IdleBoard Server (Port 3000)`) ve `node.exe` izni otomatik eklenir.
   - Program kaldırıldığında bu güvenlik duvarı kuralları temizlenir.

4. **Kısayol Seçenekleri:**
   - **Başlat Menüsü:** Otomatik ve seçili olarak oluşturulur:
     - *IdleBoard Yönetim Paneli* (`http://localhost:3000`)
     - *Sunucu Servisini Başlat*
     - *Sunucu Servisini Durdur*
     - *Sunucu Servisini Yeniden Başlat*
     - *Yönetici Parolasını Sıfırla*
   - **Masaüstü Simgesi:** Varsayılan olarak **seçili değildir**, kullanıcı isterse kurulumda kutucuğu işaretleyebilir.

5. **Kurulum Bitişinde Yönetim Panelini Aç:**
   - Kurulum sihirbazının son adımında "IdleBoard Yönetim Panelini Aç" seçeneği varsayılan işaretli gelir ve "Bitir" dendiğinde varsayılan tarayıcıda `http://localhost:3000` sayfası açılır.

6. **Hedef Dizin Seçimi:**
   - Kullanıcı dilerse kurulum dizinini sihirbaz ekranından değiştirebilir (Varsayılan: `C:\Program Files\IdleBoard\Server`).

---

## Yeni Kurulum Paketi Oluşturma (Tek Komut)

Yeni bir sunucu kurulum paketi üretmek istediğinizde PowerShell üzerinden aşağıdaki betiği çalıştırmanız yeterlidir:

```powershell
& "IdleBoardServer\installer\build-installer.ps1"
```

Üretilen kurulum dosyası şu konuma kaydedilir:
`IdleBoardServer\installer_output\IdleBoardServer_Setup.exe`
