import { defineConfig } from "vite";

export default defineConfig({
    // The built experiment is served from Sansara's /experiments path on
    // GitHub Pages as well as from the local Vite server.
    base: "./",
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        target: "esnext",
        // The source is shipped alongside the bundle; keep the hosted
        // experiment lean instead of duplicating every renderer module in maps.
        sourcemap: false,
    },
    // .wgsl imported via ?raw
    assetsInclude: ["**/*.hdr", "**/*.env"],
});
