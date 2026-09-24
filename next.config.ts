import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // 型別錯誤會讓建置失敗，避免有 bug 的版本被部署上線
  eslint: {
    ignoreDuringBuilds: true,
  },
  output: 'export',
  basePath: '/domain-meeting-go',
  assetPrefix: '/domain-meeting-go/',
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // experimental: { serverActions: { ... } } can be removed.
};

export default nextConfig;