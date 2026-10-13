/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Enables src/instrumentation.ts (built-in scheduled jobs on Render).
  experimental: { instrumentationHook: true },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" }, // keeps private booking links out of referrers
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }, // camera: QR check-in
        ],
      },
    ];
  },
};
export default nextConfig;
