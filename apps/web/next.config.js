// The dashboard calls the API through its own origin (/api/v1/*), proxied here. This removes the
// need for cross-origin calls and lets E2E tests reach the API from inside the compose network.
const apiOrigin = process.env.API_INTERNAL_URL || 'http://api:4000';

module.exports = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};
