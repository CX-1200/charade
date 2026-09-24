/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The question bank's permanent copy (data/questions.csv) is read at runtime,
  // so ship it inside every API function bundle.
  outputFileTracingIncludes: {
    '/api/**/*': ['./data/**/*'],
  },
};

export default nextConfig;
