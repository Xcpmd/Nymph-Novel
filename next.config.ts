import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 是原生模块，必须交给 Node 运行时直接 require，不能被打包器处理
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // 局部重写与长文生成需要传较大的正文负载
    serverActions: { bodySizeLimit: '16mb' },
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
