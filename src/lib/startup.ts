// Side-effect-only module: starts the background device-attendance sync
// once per server process. Import this (for its side effect, no named
// import) from somewhere guaranteed to load on every request in the
// Node.js runtime - the root layout - so it starts on the very first page
// render after boot without needing Next's instrumentation hook, which
// bundles for the edge runtime too and fails on node-zklib's net/dgram/fs
// usage even when the code never actually runs there.
import { initAttendanceRealtime } from "@/lib/attendance-realtime";

// `next build` imports every page (and so this module) once per static-
// generation worker just to render it - NEXT_PHASE distinguishes that from
// an actual running server, so the real-time listener isn't started (and
// immediately discarded) a dozen times during every build.
// Vercel cannot reach the device on the factory LAN, and the listener would hold DB connections on every serverless instance.
if (process.env.NEXT_PHASE !== "phase-production-build" && !process.env.VERCEL) {
  initAttendanceRealtime();
}
