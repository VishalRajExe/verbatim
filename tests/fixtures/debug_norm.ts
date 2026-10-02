import { keepView, joinView } from "@/lib/text/normalize"

const docText = `1.2 \u201cForce Majeure\u201d means any event beyond the reasonable control\nof the affected party, including acts of God.`
const quote = "Force Majeure means any event beyond the reasonable control of the affected party, including acts of God."

const kv = keepView(docText)
const kq = keepView(quote)
console.log("DocText keepView:", JSON.stringify(kv.s.slice(0, 120)))
console.log("Quote keepView:", JSON.stringify(kq.s))
console.log("Match in doc:", kv.s.includes(kq.s))

const jv = joinView(docText)
const jq = joinView(quote)
console.log("\nDocText joinView:", JSON.stringify(jv.s.slice(0, 120)))
console.log("Quote joinView:", JSON.stringify(jq.s))
console.log("Match in join:", jv.s.includes(jq.s))

process.exit(0)