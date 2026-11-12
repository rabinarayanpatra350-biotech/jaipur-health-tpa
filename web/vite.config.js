import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // In production the API is a different origin, so the base URL is configuration.
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || '') },
});
