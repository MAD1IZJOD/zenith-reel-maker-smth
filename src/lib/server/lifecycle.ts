export async function register() {
  const { initializeQueue, beginShutdown, queueStats } = await import("@/lib/jobs/queue");
  const { cleanupExpiredSessions } = await import("@/lib/storage/session-storage");
  await initializeQueue();
  const global = globalThis as typeof globalThis & { studioCleanupTimer?: ReturnType<typeof setInterval> };
  if (global.studioCleanupTimer) return;
  const clean = () => { void cleanupExpiredSessions().catch(() => console.error("Scheduled retention cleanup failed")); };
  clean(); global.studioCleanupTimer = setInterval(clean, 60_000); global.studioCleanupTimer.unref();
  const shutdown = () => { beginShutdown(); console.info("Studio draining", { activeRenders: queueStats().running }); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
