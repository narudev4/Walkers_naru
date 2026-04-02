/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // /embed/* ページはiframeでの表示を許可
        source: '/embed/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
        ],
      },
      {
        // API は CORS を許可
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, X-API-Key, X-Machine-Id' },
        ],
      },
    ]
  },
}
module.exports = nextConfig
