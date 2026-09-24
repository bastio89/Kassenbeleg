/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp ist ein natives Modul und darf nicht gebündelt werden
  serverExternalPackages: ["sharp", "postgres"],
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
  },
};

export default nextConfig;
