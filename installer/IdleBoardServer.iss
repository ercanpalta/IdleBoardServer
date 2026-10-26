; ==========================================================
; IdleBoard Server - Inno Setup Kurulum Yapılandırması
; ==========================================================

#define MyAppName "IdleBoard Server"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Ercan Palta"
#define MyAppURL "http://localhost:3000"

#ifndef NodeExePath
  #define NodeExePath "C:\Program Files\nodejs\node.exe"
#endif

[Setup]
AppId={{9B78C210-213E-4B14-B978-75F9329C351B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\IdleBoard\Server
DefaultGroupName=IdleBoard\Server
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=admin
OutputDir=..\installer_output
OutputBaseFilename=IdleBoardServer_Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; Windows Dosya ve Versiyon Bilgileri
VersionInfoCompany=IdleBoard
VersionInfoDescription=IdleBoard Server Kurulumu
VersionInfoVersion=1.0.0.0
VersionInfoCopyright=Copyright 2026 Ercan Palta
VersionInfoProductName=IdleBoard Server

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
turkish.OpenDashboard=IdleBoard Yönetim Panelini Aç (http://localhost:3000)
english.OpenDashboard=Open IdleBoard Management Panel (http://localhost:3000)
turkish.StartServerDesc=Sunucu Servisini Başlat
english.StartServerDesc=Start Server Service
turkish.StopServerDesc=Sunucu Servisini Durdur
english.StopServerDesc=Stop Server Service
turkish.RestartServerDesc=Sunucu Servisini Yeniden Başlat
english.RestartServerDesc=Restart Server Service
turkish.ResetPassDesc=Yönetici Parolasını Sıfırla
english.ResetPassDesc=Reset Admin Password
turkish.ServerStartingTitle=IdleBoard Sunucusu Başlatılıyor
english.ServerStartingTitle=Starting IdleBoard Server
turkish.ServerStartingDesc=Sunucu servisinin başlaması ve hazır hale gelmesi bekleniyor...
english.ServerStartingDesc=Waiting for the server service to start and become ready...
turkish.ServerStartingStatus=Sunucu başlatılıyor, lütfen bekleyin...
english.ServerStartingStatus=Server is starting, please wait...

[Tasks]
; Masaüstü kısayolu varsayılan olarak seçili DEĞİL, kullanıcı isterse işaretler
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Dirs]
Name: "{app}\data"; Permissions: users-modify
Name: "{app}\images"; Permissions: users-modify
Name: "{app}\thumbnails"; Permissions: users-modify
Name: "{app}\logs"; Permissions: users-modify
Name: "{app}\scripts"; Permissions: users-modify

[Files]
; Taşınabilir Node.js Çalışma Ortamı (Gömülü Node.js)
Source: "{#NodeExePath}"; DestDir: "{app}"; Flags: ignoreversion
; Sunucu Uygulama Kaynak Dosyaları
Source: "..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\updateManager.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\reset-password.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
; Statik Web Arayüzü
Source: "..\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
; Node Bağımlılıkları
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
; Varsayılan Ayarlar (Eğer mevcutsa üzerine yazma)
Source: "..\data\server-settings.json"; DestDir: "{app}\data"; Flags: onlyifdoesntexist
; Yönetim Betikleri
Source: "scripts\*.bat"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
; Başlat Menüsü Kısayolları (Varsayılan olarak seçili / her zaman oluşturulur)
Name: "{autoprograms}\{#MyAppName}\IdleBoard Yönetim Paneli"; Filename: "http://localhost:3000"
Name: "{autoprograms}\{#MyAppName}\{cm:StartServerDesc}"; Filename: "{app}\scripts\start-server.bat"
Name: "{autoprograms}\{#MyAppName}\{cm:StopServerDesc}"; Filename: "{app}\scripts\stop-server.bat"
Name: "{autoprograms}\{#MyAppName}\{cm:RestartServerDesc}"; Filename: "{app}\scripts\restart-server.bat"
Name: "{autoprograms}\{#MyAppName}\{cm:ResetPassDesc}"; Filename: "{app}\scripts\reset-password.bat"
Name: "{autoprograms}\{#MyAppName}\{#MyAppName} Kaldır"; Filename: "{uninstallexe}"

; Masaüstü Kısayolu (Varsayılan olarak seçili değil)
Name: "{autodesktop}\IdleBoard Yönetim Paneli"; Filename: "http://localhost:3000"; Tasks: desktopicon

[Run]
; Kurulum Bitişinde Yönetim Panelini Aç (Madde 6: Seçenek olarak gelir ve varsayılan seçilidir)
Filename: "http://localhost:3000"; Description: "{cm:OpenDashboard}"; Flags: postinstall shellexec nowait

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\IdleBoardServerTask.xml"

[Code]
var
  ServerProgressPage: TOutputProgressWizardPage;

procedure InitializeWizard();
begin
  ServerProgressPage := CreateOutputProgressPage(
    CustomMessage('ServerStartingTitle'),
    CustomMessage('ServerStartingDesc')
  );
end;

// Windows Görev Zamanlayıcısı (Task Scheduler) ile Arka Plan Servisi Kaydı (100% Yerel Windows Bileşeni)
procedure RegisterServerTask();
var
  AppDir, XmlFile, XmlContent: string;
  ResultCode: Integer;
begin
  AppDir := ExpandConstant('{app}');
  XmlFile := AppDir + '\IdleBoardServerTask.xml';

  XmlContent :=
    '<?xml version="1.0"?>' + #13#10 +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' + #13#10 +
    '  <RegistrationInfo>' + #13#10 +
    '    <Description>IdleBoard Server Background Service</Description>' + #13#10 +
    '  </RegistrationInfo>' + #13#10 +
    '  <Triggers>' + #13#10 +
    '    <BootTrigger>' + #13#10 +
    '      <Enabled>true</Enabled>' + #13#10 +
    '    </BootTrigger>' + #13#10 +
    '  </Triggers>' + #13#10 +
    '  <Principals>' + #13#10 +
    '    <Principal id="Author">' + #13#10 +
    '      <UserId>S-1-5-18</UserId>' + #13#10 +
    '      <RunLevel>HighestAvailable</RunLevel>' + #13#10 +
    '    </Principal>' + #13#10 +
    '  </Principals>' + #13#10 +
    '  <Settings>' + #13#10 +
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>' + #13#10 +
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>' + #13#10 +
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>' + #13#10 +
    '    <AllowHardTerminate>true</AllowHardTerminate>' + #13#10 +
    '    <StartWhenAvailable>true</StartWhenAvailable>' + #13#10 +
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>' + #13#10 +
    '    <IdleSettings>' + #13#10 +
    '      <StopOnIdleEnd>false</StopOnIdleEnd>' + #13#10 +
    '      <RestartOnIdle>false</RestartOnIdle>' + #13#10 +
    '    </IdleSettings>' + #13#10 +
    '    <AllowStartOnDemand>true</AllowStartOnDemand>' + #13#10 +
    '    <Enabled>true</Enabled>' + #13#10 +
    '    <Hidden>false</Hidden>' + #13#10 +
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>' + #13#10 +
    '    <WakeToRun>false</WakeToRun>' + #13#10 +
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>' + #13#10 +
    '    <Priority>7</Priority>' + #13#10 +
    '  </Settings>' + #13#10 +
    '  <Actions Context="Author">' + #13#10 +
    '    <Exec>' + #13#10 +
    '      <Command>' + AppDir + '\node.exe</Command>' + #13#10 +
    '      <Arguments>server.js</Arguments>' + #13#10 +
    '      <WorkingDirectory>' + AppDir + '</WorkingDirectory>' + #13#10 +
    '    </Exec>' + #13#10 +
    '  </Actions>' + #13#10 +
    '</Task>';

  SaveStringToFile(XmlFile, XmlContent, False);
  Exec('schtasks', '/create /tn "IdleBoardServer" /xml "' + XmlFile + '" /f', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('schtasks', '/run /tn "IdleBoardServer"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure UnregisterServerTask();
var
  ResultCode: Integer;
begin
  Exec('schtasks', '/end /tn "IdleBoardServer"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('schtasks', '/delete /tn "IdleBoardServer" /f', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Sunucu servisinin arka planda portu dinlemeye başlamasını bekle ve ilerleme ekranını göster
procedure WaitForServerReady();
var
  I, ResultCode: Integer;
begin
  ServerProgressPage.SetText(CustomMessage('ServerStartingStatus'), '');
  ServerProgressPage.SetProgress(0, 10);
  ServerProgressPage.Show;
  try
    for I := 1 to 10 do
    begin
      ServerProgressPage.SetProgress(I, 10);
      Exec('cmd.exe', '/c netstat -ano | findstr :3000 | findstr LISTENING', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      if ResultCode = 0 then
      begin
        ServerProgressPage.SetProgress(10, 10);
        Sleep(1000); // Express sunucusunun istekleri tam karşılaması için ek güvenlik payı
        Break;
      end;
      Sleep(1000);
    end;
  finally
    ServerProgressPage.Hide;
  end;
end;

// Kurulum Sonrası: Güvenlik duvarı kuralını ekle, Windows Hizmetini kaydet ve başlat
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // 1. Windows Güvenlik Duvarı İzinleri (Port 3000 ve Node.exe)
    Exec('netsh', 'advfirewall firewall add rule name="IdleBoard Server (Port 3000)" dir=in action=allow protocol=TCP localport=3000', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        Exec('netsh', 'advfirewall firewall add rule name="IdleBoard Server Discovery (UDP 38899)" dir=in action=allow protocol=UDP localport=38899', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('netsh', 'advfirewall firewall add rule name="IdleBoard Server Node" dir=in action=allow program="' + ExpandConstant('{app}\node.exe') + '" enable=yes', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    // 2. Windows Görev Zamanlayıcısı ile Arka Plan Servisini Kaydet ve Başlat (Madde 2: Zorunlu ve Sessiz)
    RegisterServerTask();

    // 3. Sunucunun hazır hale gelmesini bekle ve ilerleme ekranını göster
    WaitForServerReady();
  end;
end;

// Kaldırma Öncesi: Hizmeti durdur, kaldır ve güvenlik duvarı kuralını temizle
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    // 1. Görevi Durdur ve Kaldır
    UnregisterServerTask();

    // 2. Güvenlik Duvarı Kurallarını Temizle
    Exec('netsh', 'advfirewall firewall delete rule name="IdleBoard Server (Port 3000)"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        Exec('netsh', 'advfirewall firewall delete rule name="IdleBoard Server Discovery (UDP 38899)"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('netsh', 'advfirewall firewall delete rule name="IdleBoard Server Node"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
