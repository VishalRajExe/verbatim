import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPdfSpike() {
  console.log('--- Spike A: pdfjs-dist Server-Side Extraction ---');
  
  // Try importing pdfjs-dist
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  const pdfPath = path.resolve(__dirname, '../tests/fixtures/sample_contract.pdf');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
  
  const pdfDoc = await loadingTask.promise;
  console.log(`PDF loaded successfully. Number of pages: ${pdfDoc.numPages}`);
  
  // Page 1
  const page1 = await pdfDoc.getPage(1);
  const viewport = page1.getViewport({ scale: 1.0 });
  console.log(`Page 1 dimensions: width=${viewport.width}, height=${viewport.height}`);
  
  const textContent = await page1.getTextContent();
  console.log(`Total text items on page 1: ${textContent.items.length}`);
  
  console.log('\n--- Inspecting First 10 Text Items ---');
  const items = textContent.items.slice(0, 10);
  items.forEach((item, idx) => {
    if ('str' in item) {
      console.log(`Item [${idx}]:`);
      console.log(`  str: "${item.str}"`);
      console.log(`  transform: [${item.transform.join(', ')}]`);
      console.log(`  width: ${item.width}`);
      console.log(`  height: ${item.height}`);
      console.log(`  hasEOL: ${item.hasEOL}`);
    }
  });
  
  console.log('\n--- Searching for Real Passage ---');
  const targetSentence = "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.";
  
  // Find text item or assembled text matching target
  let fullPageText = '';
  const textPieces = [];
  
  for (const item of textContent.items) {
    if ('str' in item) {
      textPieces.push(item);
      fullPageText += item.str + (item.hasEOL ? '\n' : ' ');
    }
  }
  
  console.log(`Full Page Text Contains Target: ${fullPageText.includes(targetSentence)}`);
  
  // Look for items containing pieces of the liability clause
  const matchingItems = textPieces.filter(item => 
    item.str.includes("Supplier's aggregate liability") || 
    item.str.includes("AED 100,000") ||
    targetSentence.includes(item.str.trim()) && item.str.trim().length > 5
  );
  
  console.log(`Matching items count: ${matchingItems.length}`);
  matchingItems.forEach((item, i) => {
    console.log(`Match [${i}]: text="${item.str}", transform=[${item.transform}], width=${item.width}, height=${item.height}, page=1`);
  });

  return {
    numPages: pdfDoc.numPages,
    itemsCount: textContent.items.length,
    containsSentence: fullPageText.includes(targetSentence),
    itemFields: Object.keys(items[0] || {})
  };
}

runPdfSpike()
  .then(res => {
    console.log('\nSpike A Result:', JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Spike A Failed:', err);
    process.exit(1);
  });
