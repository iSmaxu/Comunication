import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.secureteam.app',
  appName: 'SecureTeam',
  webDir: 'dist',
  server: {
    // Allow WebView to talk to our backend
    allowNavigation: ['secureteam-backend.onrender.com'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
