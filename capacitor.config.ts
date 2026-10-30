import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell (Android for now): Capacitor wraps the Vite build in a
 * WebView. Build and sync with `npm run android:sync`, then `npm run
 * android:open` (Android Studio) to run it or build the release bundle.
 */
const config: CapacitorConfig = {
  // Permanent once the app is on Google Play: it can never be changed
  // afterwards, so settle it before the first upload.
  appId: "com.sonnywebdesign.radarcommand",
  appName: "Radar Command",
  webDir: "dist",
  // The WebView's origin is https://localhost (Android's default). The
  // leaderboard API allows it (api/_lib/cors.ts); the game reaches the API
  // through VITE_API_BASE_URL (.env.android, src/net/apiBase.ts).
  android: {
    // Never fall back to http: the game only talks to an https API.
    allowMixedContent: false,
  },
};

export default config;
