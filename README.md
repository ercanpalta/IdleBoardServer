# IdleBoard Server

A Node.js and Express backend service featuring Server-Sent Events (SSE) for real-time image broadcasting to connected display screens, accompanied by a comprehensive web administration dashboard.

## 🚀 Key Features

- **Real-Time Image Streaming (SSE):** Dynamic, unidirectional image streaming to client screens over Server-Sent Events with heartbeat monitoring and auto-reconnect handling.
- **Web Administration Dashboard:** Modern, responsive control panel for uploading images, managing playlists, instant screen broadcasts, pausing playback, and pinning media.
- **Dynamic Slideshow Engine:** Configurable slide transition intervals, customizable display order (sequential / randomized), and smooth transition effects.
- **Robust Security Layer:**
  - Content Security Policy (CSP) & Permissions Policy headers
  - Brute-force mitigation and IP-based flood rate limiting
  - Secure authentication via `HttpOnly`, `SameSite=Strict` session cookies
  - Strong password policy validation with `scrypt` cryptographic key derivation and interactive strength meter
  - Cross-Origin (Origin & Referer) protection and local-network-friendly CORS
  - 100 MB maximum upload limit with magic bytes signature validation and decompression bomb protection
- **Organized Storage:** Isolated runtime data storage (`data/` directory) with automated migration from legacy paths.

## 📦 Requirements & Installation

- **Node.js:** v18.0.0 or higher
- **npm:** v9.0.0 or higher

```bash
# Install dependencies
npm install

# Start the server (default port: 3000)
npm start
```

Once running, navigate to `http://localhost:3000` in your web browser to access the administration dashboard.

## ⚙️ Configuration & API Endpoints

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/events` | `GET` | SSE stream for real-time display image updates |
| `/api/auth/status` | `GET` | Check administrative authentication setup status |
| `/api/login` | `POST` | Authenticate administrator session |
| `/api/gallery` | `GET` | Retrieve list of uploaded images and current broadcast status |
| `/api/upload` | `POST` | Upload new media (JPG, PNG, WebP up to 100 MB) |
| `/api/broadcast/:name` | `POST` | Instantly broadcast a specific image to all connected displays |
| `/api/settings` | `GET` / `POST` | Read or update slideshow intervals, display modes, and preferences |

## 🛡️ License

ISC License
