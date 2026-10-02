export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverUnfinishedJobs } = await import("@/lib/jobs/recover");
    await recoverUnfinishedJobs();
  }
}
