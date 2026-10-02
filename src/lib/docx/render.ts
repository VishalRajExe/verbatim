import { unzipSync } from "fflate";

export interface DocxRenderOptions {
  showRevisions?: boolean; // Default true: render <ins> and <del> tags
}

/**
 * Converts a DOCX buffer into clean, semantic HTML preserving
 * paragraphs, headings, tables, bold text, lists, and Word tracked changes.
 */
export function renderDocxToHtml(
  docxBuffer: Buffer | Uint8Array,
  options: DocxRenderOptions = { showRevisions: true }
): string {
  try {
    const unzipped = unzipSync(new Uint8Array(docxBuffer));
    const docXmlBytes = unzipped["word/document.xml"];

    if (!docXmlBytes) {
      return '<p class="text-sm text-ink-muted italic">Empty or invalid Word document structure.</p>';
    }

    const xml = Buffer.from(docXmlBytes).toString("utf-8");
    return parseDocxXml(xml, options);
  } catch (err) {
    console.error("Failed to render DOCX to HTML:", err);
    return '<p class="text-sm text-danger italic">Unable to preview this Word document. Download the DOCX instead.</p>';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseDocxXml(xml: string, options: DocxRenderOptions): string {
  let html = "";
  const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) {
    return '<p class="text-sm text-ink-muted">Unable to locate document body.</p>';
  }

  const bodyContent = bodyMatch[1];

  function parseParagraph(pXml: string, isInsideTable = false): string {
    const isTitle = /<w:pStyle[^>]*w:val=["']Title["']/i.test(pXml);
    const isHeading1 = /<w:pStyle[^>]*w:val=["']Heading1["']/i.test(pXml);
    const isHeading2 = /<w:pStyle[^>]*w:val=["']Heading2["']/i.test(pXml);
    const isHeading3 = /<w:pStyle[^>]*w:val=["']Heading3["']/i.test(pXml);

    let innerHtml = "";

    // Find all runs, insertions, deletions
    const runOrRevRegex = /<w:(r|ins|del)[^>]*>([\s\S]*?)<\/w:\1>/g;
    let rMatch: RegExpExecArray | null;

    while ((rMatch = runOrRevRegex.exec(pXml)) !== null) {
      const type = rMatch[1];
      const content = rMatch[2];

      const isBold = /<w:b(\s|\/|>)/.test(content);
      const isItalic = /<w:i(\s|\/|>)/.test(content);
      const isUnderline = /<w:u(\s|\/|>)/.test(content);

      // Extract author if revision
      const authorMatch = rMatch[0].match(/w:author=["']([^"']+)["']/);
      const author = authorMatch ? escapeHtml(authorMatch[1]) : "Verbatim AI";

      // Extract text from w:t or w:delText
      const textMatches =
        content.match(/<w:(t|delText)[^>]*>([^<]*)<\/w:\1>/g) || [];
      let text = "";
      for (const tm of textMatches) {
        const textVal = tm.replace(/<[^>]+>/g, "");
        text += textVal;
      }

      if (!text) continue;

      let formattedText = escapeHtml(text);

      if (isBold) formattedText = `<strong>${formattedText}</strong>`;
      if (isItalic) formattedText = `<em>${formattedText}</em>`;
      if (isUnderline) formattedText = `<u>${formattedText}</u>`;

      if (type === "ins") {
        if (options.showRevisions !== false) {
          innerHtml += `<ins class="docx-ins bg-verified-soft text-verified underline decoration-verified font-medium px-1 py-0.5 rounded cursor-help transition-colors" title="Inserted by ${author}">${formattedText}</ins>`;
        } else {
          innerHtml += formattedText;
        }
      } else if (type === "del") {
        if (options.showRevisions !== false) {
          innerHtml += `<del class="docx-del bg-del/10 text-del-ink line-through decoration-del-ink px-1 py-0.5 rounded opacity-80 cursor-help transition-colors" title="Deleted by ${author}">${formattedText}</del>`;
        }
        // If showRevisions === false, deletions are omitted entirely (Clean final view)
      } else {
        innerHtml += formattedText;
      }
    }

    if (!innerHtml.trim()) {
      return isInsideTable ? "&nbsp;" : "";
    }

    if (isInsideTable) {
      return `<p class="leading-relaxed mb-0">${innerHtml}</p>`;
    }

    if (isTitle) {
      return `<h1 class="text-2xl font-bold font-serif text-ink tracking-tight border-b border-line pb-3 mb-5 mt-2">${innerHtml}</h1>`;
    } else if (isHeading1) {
      return `<h2 class="text-lg font-semibold font-serif text-ink mt-7 mb-3 border-b border-line/50 pb-1.5">${innerHtml}</h2>`;
    } else if (isHeading2) {
      return `<h3 class="text-base font-semibold font-serif text-ink mt-5 mb-2">${innerHtml}</h3>`;
    } else if (isHeading3) {
      return `<h4 class="text-sm font-semibold font-serif text-ink mt-4 mb-1">${innerHtml}</h4>`;
    }

    return `<p class="text-sm font-serif text-ink leading-relaxed mb-3.5">${innerHtml}</p>`;
  }

  function parseTable(tblXml: string): string {
    let tblHtml =
      '<div class="overflow-x-auto my-5 rounded-lg border border-line shadow-sm"><table class="w-full border-collapse text-xs font-serif">';
    const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
    let rowMatch: RegExpExecArray | null;
    let isFirstRow = true;

    while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
      tblHtml += `<tr class="${
        isFirstRow
          ? "bg-sunken font-sans font-semibold text-ink border-b border-line"
          : "border-b border-line/60 hover:bg-paper/40 transition-colors"
      }">`;

      const cellRegex = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const cellPMatches =
          cellMatch[1].match(/<w:p[^>]*>[\s\S]*?<\/w:p>/g) || [];
        const cellContent = cellPMatches
          .map((p) => parseParagraph(p, true))
          .filter(Boolean)
          .join("");

        const tag = isFirstRow ? "th" : "td";
        tblHtml += `<${tag} class="border-r last:border-r-0 border-line/60 px-3 py-2.5 text-left">${
          cellContent || "&nbsp;"
        }</${tag}>`;
      }

      tblHtml += "</tr>";
      isFirstRow = false;
    }

    tblHtml += "</table></div>";
    return tblHtml;
  }

  const blockRegex = /<w:(p|tbl)[^>]*>[\s\S]*?<\/w:\1>/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(bodyContent)) !== null) {
    if (blockMatch[1] === "p") {
      html += parseParagraph(blockMatch[0]);
    } else if (blockMatch[1] === "tbl") {
      html += parseTable(blockMatch[0]);
    }
  }

  return html;
}
