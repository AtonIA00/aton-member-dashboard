import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  async headers() {
    return [
      {
        // Página é embedada como iframe dentro do painel Uchat. CSP permissivo
        // pra permitir embed. TODO: restringir frame-ancestors ao host Uchat
        // após confirmar com Murillo qual domínio carrega o iframe.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
