import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.heiwan.daijia',
  appName: '黑湾代驾',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'heiwan.daijia',
    cleartext: true,
    allowNavigation: [
      'lyheiwandaijiamax.com',
      '*.lyheiwandaijiamax.com',
      '*.run.app',
      '*.aliyuncs.com'
    ]
  }
};

export default config;
