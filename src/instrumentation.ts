export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const lifecycle = await import("@/lib/server/lifecycle");
    await lifecycle.register();
  }
}
