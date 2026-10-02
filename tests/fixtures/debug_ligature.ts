import { keepView } from "@/lib/text/normalize"
// Simulate what pdfjs gives us for the fi-ligature line
// pdfjs extracted "nnalised" for the fi ligature in Helvetica
const docText = "The terms and conditions are nnalised and binding."
const quote = "The terms and conditions are finalised and binding."
const kd = keepView(docText)
const kq = keepView(quote)
console.log("doc:", JSON.stringify(kd.s))
console.log("quote:", JSON.stringify(kq.s))
console.log("match:", kd.s.includes(kq.s))

// What does loose key do?
import { looseKey } from "@/lib/text/normalize"
const ld = looseKey(docText)
const lq = looseKey(quote)
console.log("\nloose doc:", JSON.stringify(ld.s))
console.log("loose quote:", JSON.stringify(lq.s))
console.log("loose match:", ld.s.includes(lq.s))
process.exit(0)