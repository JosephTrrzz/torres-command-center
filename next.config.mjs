/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  output: "export",
  outputFileTracingRoot: process.cwd(),
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
