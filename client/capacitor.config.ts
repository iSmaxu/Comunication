import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.secureteam.app',
  appName: 'SecureTeam',
  webDir: 'dist',
  server: {
    // Use https scheme so Android WebView treats it like a real site
    androidScheme: 'https',
    // Allow WebView to navigate to our backend
    allowNavigation: ['secureteam-backend.onrender.com'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      // Enable native HTTP stack but we call it directly, not via fetch patch
      enabled: true,
    },
  },
};

export default config;
