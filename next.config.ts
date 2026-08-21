import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The engine writes data/export/*.json; the app reads it at build time.
  // Nothing in the app process touches the network or the database.
  outputFileTracingIncludes: { '/**': ['./data/export/**'] },
}

export default nextConfig
