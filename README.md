# Scanzap

A high-performance, single-file QR Code Generator featuring a Pay-As-You-Go credit system, custom designs, and aggressive client-side anti-theft security.

## Overview

Scanzap was rebuilt from the ground up to replace a traditional monthly subscription model with a fluid, high-conversion **Credit/Token System**. The entire frontend is contained within a single `index.html` file—no build tools, no React, no Webpack. Just raw, optimized HTML/CSS/JS targeting the absolute minimum time-to-interactive.

## Features

- **Single-File Architecture:** Zero build tools. `index.html` contains all inline CSS and JS.
- **Credit Monetization:** Users buy packs (Starter, Creator, Studio, Agency) instead of monthly subscriptions. Guests get 5 free credits, registered users get 10 free + 2 daily.
- **6 Advanced QR Types:** URL, Text, Email, Phone, WiFi, and vCard.
- **Customizations:** Foreground/background colors, dot styles, eye shapes, and HTML5 Canvas-based Logo embedding.
- **Vector Exports:** High-resolution PNGs and pure SVGs.
- **Camera Scanner:** Built-in JS-based QR code tester using `getUserMedia()`.
- **Firebase Backend:**
  - Google Auth for user accounts.
  - Firestore for tracking credits and QR history.
  - Cloud Functions (in `/functions`) for secure payment verification.
- **Razorpay Integration:** Fast UPI/Card checkouts.

## 🛡️ Aggressive Anti-Theft Security

Since Scanzap charges credits for premium downloads (high-res PNGs, SVGs), it includes aggressive client-side deterrents to prevent users from simply screenshotting the live preview:

1. **Focus/Blur Thwarting:** The QR code immediately blurs and overlays a warning if the browser window loses focus (preventing OS-level Snipping Tools).
2. **Invisible DOM Shield:** An absolute-positioned transparent `<div>` covers the QR image, intercepting all right-clicks and mobile long-presses (Save Image).
3. **Print Media Block:** A `@media print` rule blanks out the entire document to prevent saving to PDF.
4. **DevTools Trap:** A periodic `debugger;` statement detects if Developer Tools are open and forces the QR to blur.
5. **Keyboard Locks:** Global `keydown` listeners block PrintScreen (clears clipboard), Ctrl+S (Save), Ctrl+P (Print), Ctrl+U (View Source), and F12/Ctrl+Shift+I.
6. **Selection Locks:** Global CSS `user-select: none` and image dragging disabled.

*(Note: Client-side security is never 100% foolproof against determined attackers, but these measures effectively block 99% of casual users trying to bypass the credit system).*

## Development & Setup

### Prerequisites
- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)

### Configuration
1. **Frontend:** Open `index.html` and replace `FIREBASE_CONFIG` and `RAZORPAY_KEY` with your actual project keys.
2. **Backend:** In `functions/index.js`, configure your Razorpay Secret (or set it via Firebase env variables).

### Running Locally
To test the frontend, simply open `index.html` in your browser. Since it uses Firebase CDN compat SDKs, it works directly from the file system (`file://`), but a local web server (like `npx serve`) is recommended for testing the camera and auth features.

To deploy the backend:
```bash
cd functions
npm install
firebase deploy --only functions
```

To test the backend locally without real payments, you can set `bypassTest: true` in the `index.html` `verifyFn` call.

## Deployment

Deploy the `index.html` file to Firebase Hosting (or any static host):
```bash
firebase deploy --only hosting
```

## License
Proprietary. © 2024 ScanZap India.
