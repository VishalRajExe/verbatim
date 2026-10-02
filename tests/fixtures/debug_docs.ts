import { db } from "@/lib/db"
import { processDocument } from "@/lib/ingest/pipeline"
import path from "path"
import fs from "fs"
import { NextRequest } from "next/server"
import { POST as uploadDoc } from "@/app/api/documents/route"

async function main() {
  // Get last two docs
  const docs = await db.document.findMany({ 
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, name: true, status: true }
  })
  console.log("Recent docs:", JSON.stringify(docs, null, 2))
  
  for (const doc of docs) {
    const txt = await db.documentText.findUnique({ where: { documentId: doc.id }, select: { text: true } })
    console.log(`\n--- ${doc.name} (${doc.status}) ---`)
    if (txt) console.log(txt.text.slice(0, 500))
    else console.log("NO TEXT")
  }
  
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })