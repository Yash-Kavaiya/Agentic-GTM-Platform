import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin the workspace root.
  //
  // A stray package-lock.json in the user's home directory made Next infer the
  // home directory as the root and trace files from there. That is the kind of
  // difference that works on the machine it was configured on and fails on a
  // deploy, so it is pinned rather than inferred.
  outputFileTracingRoot: import.meta.dirname,

  // The engine writes data/export/*.json; the app reads it at build time.
  // Nothing in the app process touches the network or the database.
  outputFileTracingIncludes: { '/**': ['./data/export/**'] },
}

export default nextConfig
