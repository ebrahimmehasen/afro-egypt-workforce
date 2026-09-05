import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project: a stray lockfile in a parent
  // directory (e.g. C:\Users\<you>\package-lock.json) otherwise makes Next
  // infer the wrong root and warn on every build/dev start.
  outputFileTracingRoot: __dirname,
  // Self-contained build (server + only the deps it needs) for the Docker image.
  output: "standalone",
};

export default nextConfig;
