import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The preview pages load /page-bridge.js from this server, so the port is fixed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
