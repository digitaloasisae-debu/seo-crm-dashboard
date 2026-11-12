import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "ffmpeg-static"],
  // pdfkit loads its built-in fonts (Helvetica…) with a dynamic require, which Vercel's file tracing misses.
  outputFileTracingIncludes: {
    "/api/audit/**": ["./node_modules/pdfkit/js/**/*", "./node_modules/@react-pdf/pdfkit/**/*"],
    // The ffmpeg binary that renders Social Studio Reels (loaded by path, so tracing misses it).
    "/social": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/social/**": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/n8n/social/**": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
