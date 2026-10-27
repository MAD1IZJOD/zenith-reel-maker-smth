export async function register() {
  // The Vercel deployment redirects to the persistent studio. Never initialize
  // filesystem storage or background workers in its read-only function runtime.
  if (process.env.VERCEL === "1") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const lifecycle = await import("@/lib/server/lifecycle");
    await lifecycle.register();
  }
}
