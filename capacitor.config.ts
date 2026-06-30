import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hiwebtalk.android',
  appName: 'Hi Web Talk',
  webDir: 'dist',
  plugins: {
    CapacitorNodeJS: {
      nodeDir: 'nodejs-project',
      startMode: 'auto',
    },
  },
};

export default config;
