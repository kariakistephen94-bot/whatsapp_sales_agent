/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a production build run without clobbering a running dev server's .next folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@whiskeysockets/baileys", "pino"],
};
export default nextConfig;
