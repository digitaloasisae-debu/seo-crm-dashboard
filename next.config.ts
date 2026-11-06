import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  // pdfkit loads its built-in fonts (Helvetica…) with a dynamic require, which Vercel's file tracing misses.
  outputFileTracingIncludes: {
    "/api/audit/[crawlId]/pdf": ["./node_modules/pdfkit/js/**/*", "./node_modules/@react-pdf/pdfkit/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
