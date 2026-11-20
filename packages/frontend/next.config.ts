import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "export",
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
  // PERF-07 B-5: 帳票の描画の共有パッケージ(packages/report-renderer、file: で参照)は TypeScript のまま読み込むため、
  // Next.js でビルドの対象にする
  transpilePackages: ["report-renderer"],
  // 共有パッケージは frontend の外(packages/report-renderer)にあるため、Turbopack が読み込める範囲を packages/ まで広げる
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
  },
};

export default nextConfig;
