import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async rewrites() {
    const base = process.env.UNFOLD_LIBRARY_URL;
    if (!base) return [];
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Configure a trusted public audio library URL.');
    return [{source:'/assets/:path*',destination:base.replace(/\/$/,'')+'/:path*'}];
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@unfold/core", "@unfold/agent", "@unfold/video", "@unfold/media", "@unfold/cloud", "@unfold/jobs"],
  // Native/heavy server deps stay external.
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "esbuild"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  ...(process.env.NEXT_PUBLIC_UNFOLD_BACKEND === 'supabase' ? {
    // These are worker/local-development inputs, never serverless runtime data.
    outputFileTracingExcludes: {'/*':['../../data/**','../../tmp/**','../../artifacts/**','../../notes/**','../../**/.env*','../../services/media/models/**','../../**/.remotion/**','./public/assets/**/*.mp3','./public/assets/**/*.wav']},
  } : {}),
  turbopack: {
    root: path.join(__dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
