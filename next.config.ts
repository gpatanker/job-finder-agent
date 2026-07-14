import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // Ensure the Carlito font files are bundled into the serverless function
  // for the route that renders PDFs (pdfkit reads them via fs at runtime).
  outputFileTracingIncludes: {
    "/api/jobs/[id]/generate-resume": ["./assets/fonts/**"],
  },
};

export default nextConfig;
