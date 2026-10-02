import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:3001';

async function ask(docIdOrIds, question) {
  const isMulti = Array.isArray(docIdOrIds);
  const payload = isMulti ? { documentIds: docIdOrIds } : { documentId: docIdOrIds };
  payload.title = question.slice(0, 30);

  const convRes = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const conv = await convRes.json();
  if (!conv.id) throw new Error('Create conv failed: ' + JSON.stringify(conv));

  const msgRes = await fetch(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: question })
  });

  const reader = msgRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullAnswer = '';
  let quotes = [];
  let coverage = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'token') fullAnswer += ev.text;
      if (ev.type === 'quotes') quotes = ev.quotes;
      if (ev.type === 'coverage') coverage = ev.coverage;
    }
  }

  return { convId: conv.id, fullAnswer, quotes, coverage };
}

async function run() {
  console.log('====================================================');
  console.log('RUNNING COMPREHENSIVE ACCEPTANCE & REGRESSION SUITE');
  console.log('====================================================');

  // Find demo normal contract
  const docsRes = await fetch(`${BASE_URL}/api/documents`);
  const docsData = await docsRes.json();
  const docs = docsData.documents || docsData;

  const normalDoc = docs.find(d => d.name === 'verbatim_demo_normal_contract.pdf');
  const largeDoc = docs.find(d => d.name === 'verbatim_demo_150_page_contract.pdf');
  const redlineDoc = docs.find(d => d.name === 'verbatim_redline_test_contract.docx');

  console.log('Normal doc:', normalDoc?.id, normalDoc?.name);
  console.log('Large doc:', largeDoc?.id, largeDoc?.name);
  console.log('Redline doc:', redlineDoc?.id, redlineDoc?.name);

  const results = [];

  // --- SECTION 1: CHAT TESTS Q1 - Q8 ---
  console.log('\n--- SECTION 1: CHAT TESTS Q1 - Q8 ON NORMAL CONTRACT ---');

  const chatTests = [
    { id: 'Q1', q: 'What is the liability cap?', expectQuote: true, check: (a) => a.includes('100,000') || a.includes('AED') },
    { id: 'Q2', q: 'How long does the customer have to pay an undisputed invoice?', expectQuote: true, check: (a) => a.includes('30') || a.includes('thirty') },
    { id: 'Q3', q: 'What is the interest rate for late undisputed payments?', expectQuote: true, check: (a) => a.includes('1.0%') || a.includes('1%') || a.includes('interest') },
    { id: 'Q4', q: 'How quickly must Supplier notify Customer of a confirmed security incident?', expectQuote: true, check: (a) => a.includes('48') || a.includes('forty-eight') || a.includes('undue delay') },
    { id: 'Q5', q: 'What is the governing law?', expectQuote: true, check: (a) => a.includes('Dubai') || a.includes('United Arab Emirates') || a.includes('UAE') },
    { id: 'Q6', q: 'Where are disputes arbitrated?', expectQuote: true, check: (a) => a.includes('DIAC') || a.includes('Dubai') },
    { id: 'Q7', q: 'What is the insurance coverage limit under this Agreement?', expectQuote: false, check: (a) => a.toLowerCase().includes("couldn't find") || a.toLowerCase().includes("not found") },
    { id: 'Q8', q: 'Does the Agreement require Supplier to maintain cyber insurance of at least AED 5 million?', expectQuote: false, check: (a) => a.toLowerCase().includes("couldn't find") || a.toLowerCase().includes("not found") },
  ];

  for (const t of chatTests) {
    console.log(`Asking ${t.id}: "${t.q}"...`);
    const res = await ask(normalDoc.id, t.q);
    const pass = t.check(res.fullAnswer) && (t.expectQuote ? res.quotes.length > 0 : res.quotes.length === 0);
    console.log(`  -> Quotes: ${res.quotes.length}, Answer: "${res.fullAnswer.trim().slice(0, 100)}..." [${pass ? 'PASS' : 'FAIL'}]`);
    results.push({ name: `Chat ${t.id}`, pass, answer: res.fullAnswer, quotesCount: res.quotes.length });
    await new Promise(r => setTimeout(r, 1200));
  }

  // --- SECTION 2: CROSS-PAGE TEST ---
  console.log('\n--- SECTION 2: CROSS-PAGE TEST ON 150-PAGE CONTRACT ---');
  const crossQ = 'What does the incident-report requirement say about the timeline for detection, containment, recovery and closure?';
  console.log(`Asking cross-page: "${crossQ}"...`);
  const crossRes = await ask(largeDoc.id, crossQ);
  const p37 = crossRes.quotes.find(q => q.pageStart === 37);
  const p38 = crossRes.quotes.find(q => q.pageStart === 38);
  const crossPass = Boolean(p37 && p38) && (crossRes.fullAnswer.includes('five business days') || crossRes.fullAnswer.includes('5 business days'));
  console.log(`  -> Quotes count: ${crossRes.quotes.length}`);
  console.log(`  -> Has Page 37 quote: ${Boolean(p37)}, Has Page 38 quote: ${Boolean(p38)}`);
  console.log(`  -> Answer: "${crossRes.fullAnswer.trim()}" [${crossPass ? 'PASS' : 'FAIL'}]`);
  results.push({ name: 'Cross-Page Incident Report', pass: crossPass, quotes: crossRes.quotes.map(q => `${q.ref} p.${q.pageStart}`) });
  await new Promise(r => setTimeout(r, 1500));

  // --- SECTION 3: 150-PAGE SPECIFIC TOKENS ---
  console.log('\n--- SECTION 3: 150-PAGE TOKENS AND VALUES ---');
  const largeTests = [
    { name: 'Page 87 Token', q: 'What is the unique test token on page 87?', check: (a) => a.includes('PAGE-UNIQUE-TOKEN-087') },
    { name: 'Page 150 Token', q: 'What is the unique test token on page 150?', check: (a) => a.includes('PAGE-UNIQUE-TOKEN-150') },
    { name: 'Page 1 Token', q: 'What is the unique test token on page 1?', check: (a) => a.includes('PAGE-UNIQUE-TOKEN-001') },
    { name: 'Page 150 Baseline', q: 'What is the financial baseline stated on page 150?', check: (a) => a.includes('212,500') },
    { name: 'Page 123 Reference', q: 'What is the reference value on page 123?', check: (a) => a.includes('REF-123-AED') },
  ];

  for (const lt of largeTests) {
    console.log(`Asking: "${lt.q}"...`);
    const res = await ask(largeDoc.id, lt.q);
    const pass = lt.check(res.fullAnswer);
    console.log(`  -> Answer: "${res.fullAnswer.trim().slice(0, 100)}..." [${pass ? 'PASS' : 'FAIL'}]`);
    results.push({ name: lt.name, pass, answer: res.fullAnswer });
    await new Promise(r => setTimeout(r, 1200));
  }

  // --- SECTION 4: REDLINE REGRESSION ---
  console.log('\n--- SECTION 4: REDLINE REGRESSION (100k -> 1M vs 500k -> 2M) ---');
  // Test A: 100k -> 1M (Should succeed)
  const redlineResA = await fetch(`${BASE_URL}/api/redlines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId: redlineDoc.id,
      instruction: 'Change the liability cap from AED 100,000 to AED 1,000,000.'
    })
  });
  const dataA = await redlineResA.json();
  const redA = dataA.redline || dataA;
  const passA = redA.status === 'READY' && redA.proposals?.length === 1 && redA.proposals[0].replacement === 'AED 1,000,000';
  console.log(`Redline 100k -> 1M: status=${redA.status}, proposals=${redA.proposals?.length} [${passA ? 'PASS' : 'FAIL'}]`);
  results.push({ name: 'Redline Valid Edit (100k -> 1M)', pass: passA });

  // Test B: 500k -> 2M (Must NOT edit because doc contains 100k, not 500k)
  const redlineResB = await fetch(`${BASE_URL}/api/redlines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId: redlineDoc.id,
      instruction: 'Change the liability cap from AED 500,000 to AED 2,000,000.'
    })
  });
  const dataB = await redlineResB.json();
  const redB = dataB.redline || dataB;
  const passB = !redB.proposals || redB.proposals.length === 0 || redB.droppedCount > 0 || (redB.proposals?.[0]?.rejected);
  console.log(`Redline 500k -> 2M: status=${redB.status}, ready proposals=${redB.proposals?.filter(p => !p.rejected).length || 0}, dropped=${redB.droppedCount} [${passB ? 'PASS' : 'FAIL'}]`);
  results.push({ name: 'Redline Safety Check (500k -> 2M Rejected)', pass: passB });

  // --- SECTION 5: MULTI-DOCUMENT COMPARISON ---
  console.log('\n--- SECTION 5: MULTI-DOCUMENT COMPARISON ---');
  const multiQ = 'Compare the liability provisions across these documents.';
  console.log(`Asking: "${multiQ}" across normal and 150-page contracts...`);
  const multiRes = await ask([normalDoc.id, largeDoc.id], multiQ);
  const multiPass = multiRes.quotes.length >= 2 && multiRes.fullAnswer.length > 50;
  console.log(`  -> Quotes: ${multiRes.quotes.length}, Answer length: ${multiRes.fullAnswer.length} [${multiPass ? 'PASS' : 'FAIL'}]`);
  results.push({ name: 'Multi-Document Comparison', pass: multiPass, quotesCount: multiRes.quotes.length });

  console.log('\n====================================================');
  console.log('SUMMARY OF ALL ACCEPTANCE TESTS:');
  console.log('====================================================');
  console.table(results);
}

run().catch(console.error);
