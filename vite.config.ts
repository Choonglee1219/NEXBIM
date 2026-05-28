/* eslint-disable import/no-extraneous-dependencies */
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  base: "./",
  plugins: [
    mkcert()
  ],
  esbuild: {
    supported: {
      "top-level-await": true,
    },
  },
  // add
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    emptyOutDir: false,
  },
});
