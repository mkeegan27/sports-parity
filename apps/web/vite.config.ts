import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Exposed on the LAN so a phone on the same Wi-Fi can load the dev server.
    host: true,
  },
});
