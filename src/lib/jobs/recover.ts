import { db } from "@/lib/db";
import { enqueueDocument } from "./runner";

/**
 * Recovers unfinished documents on server startup.
 * Implements PRD FR-1.7: "Unfinished processing resumes after a server restart.
 * Kill the server mid-upload, restart, and the document continues to ready (or fails visibly)."
 */
export async function recoverUnfinishedJobs(): Promise<number> {
  try {
    const unfinished = await db.document.findMany({
      where: {
        status: {
          in: ["QUEUED", "CONVERTING", "EXTRACTING", "INDEXING"],
        },
      },
      select: { id: true, name: true, status: true },
    });

    if (unfinished.length === 0) {
      return 0;
    }

    console.log(`[JobRecovery] Found ${unfinished.length} unfinished document(s) on startup. Recovering...`);

    for (const doc of unfinished) {
      await db.document.update({
        where: { id: doc.id },
        data: {
          status: "QUEUED",
          stage: "Queued for processing",
          progress: 0,
        },
      });

      enqueueDocument(doc.id);
      console.log(`[JobRecovery] Re-queued document: ${doc.name} (${doc.id})`);
    }

    return unfinished.length;
  } catch (err) {
    console.error("[JobRecovery] Error recovering unfinished jobs:", err);
    return 0;
  }
}
