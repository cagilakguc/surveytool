# SurveyTool installable app (PWA)

The web app continues to use the existing React/Vite website. It adds:
- A manifest with 192px/512px normal and maskable crosshair icons.
- Standalone display when installed through a supporting browser.
- A browser-provided installation prompt where available.
- A versioned service-worker cache of **public static application assets only**.

## Build and test
1. Run `npm ci` followed by `npm run build`. The postbuild script generates `dist/service-worker.js`.
2. Serve the built `dist` folder over HTTPS (or localhost). Service workers are disabled in Vite development mode.
3. Verify the manifest and icon dimensions in browser DevTools > Application > Manifest.
4. Install the app in Chrome/Edge on Windows or Chrome on Android, relaunch from the icon, and check navigation.
5. With the app opened once online, disable network and verify the app shell loads. File imports already in browser memory may work, but cloud projects and external basemaps require a connection.

## Important limitations
- This is not native Android/iOS packaging, offline map downloading, GNSS instrument control, or guaranteed offline access to user files.
- The service worker does **not** intercept cross-origin traffic, authenticated API calls, uploads, or POST requests.
- Uploaded survey files are **not** automatically cached. Introduce explicit encrypted or user-consented offline project storage in a later release.
- The service worker caches only hashed app assets, static icons, the manifest, and an offline fallback. Navigation uses network-first with cached app-shell fallback.
