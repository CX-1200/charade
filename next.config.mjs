/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Browser-side hardening. Everything the app loads comes from its own origin;
 * Next's bootstrap needs inline scripts and React's style props need inline
 * styles. frame-ancestors stops other sites embedding the game (clickjacking
 * the admin buttons); fullscreen stays allowed for the Full screen button.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), fullscreen=(self)',
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // The question bank's permanent copy (data/questions.csv) is read at runtime,
  // so ship it inside every API function bundle.
  outputFileTracingIncludes: {
    '/api/**/*': ['./data/**/*'],
  },
};

export default nextConfig;
