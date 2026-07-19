import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { runtimeSessionBootstrapPlugin } from "./session-bootstrap.js";

const fixtureMode = process.env.CHAI_STUDIO_UI_FIXTURE_MODE === "1";
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), runtimeSessionBootstrapPlugin()],
  define: {
    __CHAI_STUDIO_UI_FIXTURE_MODE__: JSON.stringify(fixtureMode),
  },
  resolve: {
    alias: fixtureMode
      ? [
          {
            find: /^\.\/runtime-snapshot\.js$/u,
            replacement: path.join(sourceDirectory, "src", "runtime-snapshot.fixture.ts"),
          },
          {
            find: /^\.\/delivery-seed\.js$/u,
            replacement: path.join(sourceDirectory, "src", "delivery-seed.fixture.ts"),
          },
        ]
      : [],
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": process.env.CHAI_STUDIO_SERVER_ORIGIN ?? "http://127.0.0.1:4317" },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": process.env.CHAI_STUDIO_SERVER_ORIGIN ?? "http://127.0.0.1:4317" },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-runtime",
              test: /node_modules[\\/](?:react|react-dom)[\\/]/u,
              priority: 30,
            },
            {
              name: "delivery-review",
              test: /apps[\\/]studio-web[\\/]src[\\/](?:delivery-workspace|review-workspace)\.tsx$/u,
              priority: 20,
            },
            {
              name: "animation-tools",
              test: /apps[\\/]studio-web[\\/]src[\\/](?:audio-mixer-panel|bridge-editor-panel|keyframe-editor|transcript-caption-panel)\.tsx$/u,
              priority: 20,
            },
            {
              name: "editing-tools",
              test: /apps[\\/]studio-web[\\/]src[\\/](?:inspector-panel|professional-edit-bar|program-monitor|source-inspection-monitor|timeline-editor)\.tsx$/u,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
