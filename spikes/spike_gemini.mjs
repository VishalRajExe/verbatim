import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.LLM_API_KEY;
const baseURL = process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/";
const model = process.env.LLM_MODEL || "gemini-2.5-flash";

console.log("--- Spike C: Gemini via OpenAI SDK ---");
console.log(`Base URL: ${baseURL}`);
console.log(`Model: ${model}`);
console.log(`API Key configured: ${Boolean(apiKey && apiKey.length > 5)}`);

if (!apiKey) {
  console.error("Error: LLM_API_KEY is not configured.");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL,
});

async function testStreaming() {
  console.log("\n[Test 1] Testing Streaming Completion...");
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a concise contract assistant." },
        { role: "user", content: "Say 'Hello from Verbatim streaming' and nothing else." },
      ],
      stream: true,
      max_tokens: 50,
    });

    let fullText = "";
    let chunkCount = 0;
    for await (const chunk of stream) {
      chunkCount++;
      const delta = chunk.choices[0]?.delta?.content || "";
      process.stdout.write(delta);
      fullText += delta;
    }
    console.log(`\nStream finished. Total chunks: ${chunkCount}, Full response: "${fullText.trim()}"`);
    return { success: true, chunkCount, response: fullText.trim() };
  } catch (err) {
    console.error("Streaming failed:", err);
    return { success: false, error: err.message };
  }
}

async function testJsonObject() {
  console.log("\n[Test 2A] Testing Structured Output with response_format: { type: 'json_object' }...");
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a legal entity extractor. Return valid JSON only with keys: entityName, jurisdiction, verified.",
        },
        {
          role: "user",
          content: "Extract info from: 'Acme Corp is registered in Delaware.' Return JSON only.",
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const content = completion.choices[0]?.message?.content || "";
    console.log("Raw JSON response:", content);
    const parsed = JSON.parse(content);
    console.log("Successfully parsed JSON object:", parsed);
    return { success: true, parsed };
  } catch (err) {
    console.error("json_object failed:", err.message);
    return { success: false, error: err.message };
  }
}

async function testJsonSchema() {
  console.log("\n[Test 2B] Testing Structured Output with response_format: { type: 'json_schema' }...");
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: "Extract info from: 'Acme Corp is registered in Delaware.'",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ContractEntity",
          strict: true,
          schema: {
            type: "object",
            properties: {
              entityName: { type: "string" },
              jurisdiction: { type: "string" },
              verified: { type: "boolean" },
            },
            required: ["entityName", "jurisdiction", "verified"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = completion.choices[0]?.message?.content || "";
    console.log("Raw json_schema response:", content);
    const parsed = JSON.parse(content);
    console.log("Successfully parsed json_schema object:", parsed);
    return { success: true, parsed };
  } catch (err) {
    console.log("json_schema note/failure:", err.message);
    return { success: false, error: err.message };
  }
}

async function main() {
  const streamResult = await testStreaming();
  const jsonObjectResult = await testJsonObject();
  const jsonSchemaResult = await testJsonSchema();

  console.log("\n--- Spike C Summary ---");
  console.log("Streaming:", streamResult.success ? "PASS" : "FAIL");
  console.log("json_object format:", jsonObjectResult.success ? "PASS" : "FAIL");
  console.log("json_schema format:", jsonSchemaResult.success ? "PASS" : "FAIL");
}

main();
