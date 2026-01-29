/* global pdfjsLib, PDFLib */

const fileInput = document.getElementById("file");
const runBtn = document.getElementById("run");
const statusEl = document.getElementById("status");
const directionEl = document.getElementById("direction");
const fontSizeEl = document.getElementById("fontsize");
const leadingEl = document.getElementById("leading");

// PDF.js worker (required)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.js";


fileInput.addEventListener("change", () => {
  runBtn.disabled = !fileInput.files?.length;
});

runBtn.addEventListener("click", async () => {
  try {
    const file = fileInput.files?.[0];
    if (!file) return;

    runBtn.disabled = true;
    setStatus(`Reading "${file.name}"...`);

    const arrayBuffer = await file.arrayBuffer();

    setStatus("Extracting text with PDF.js...");
    const pagesText = await extractTextByPage(arrayBuffer);

    setStatus("Building output PDF with pdf-lib...");
    const outBytes = await buildSidewaysTextPdf({
      pagesText,
      originalName: file.name,
      direction: directionEl.value,                 // "ccw" or "cw"
      fontSize: Number(fontSizeEl.value),
      leading: Number(leadingEl.value),
    });

    const outName = file.name.replace(/\.pdf$/i, "") + "_sideways_text.pdf";
    downloadBytes(outBytes, outName);

    setStatus(`Done ✅ Downloaded: ${outName}`);
  } catch (err) {
    console.error(err);
    setStatus("Error:\n" + (err?.message ?? String(err)));
  } finally {
    runBtn.disabled = false;
  }
});

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function extractTextByPage(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    setStatus(`Extracting text... (page ${p}/${pdf.numPages})`);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    // Join items; insert newline when PDF.js reports a line break-ish jump.
    // This is a heuristic (PDFs don’t “store lines” cleanly).
    const items = tc.items.map(it => ({
      str: it.str,
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
    }));

    // Sort top-to-bottom then left-to-right
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

    let out = [];
    let lastY = null;

    for (const it of items) {
      const s = (it.str ?? "").replace(/\s+/g, " ").trim();
      if (!s) continue;

      if (lastY !== null && Math.abs(it.y - lastY) > 6) {
        out.push("\n"); // new line
      } else if (out.length && out[out.length - 1] !== "\n") {
        out.push(" ");  // space between same-line chunks
      }

      out.push(s);
      lastY = it.y;
    }

    pages.push(out.join("").replace(/[ \t]+\n/g, "\n").trim());
  }

  return pages;
}

async function buildSidewaysTextPdf({ pagesText, originalName, direction, fontSize, leading }) {
  const { PDFDocument, StandardFonts, degrees } = PDFLib;

  const outPdf = await PDFDocument.create();
  const font = await outPdf.embedFont(StandardFonts.Helvetica);

  // US Letter portrait
  const W = 612; // 8.5in * 72
  const H = 792; // 11in * 72
  const margin = 0.6 * 72;

  // With text rotated 90°, the *vertical* space controls line length.
  const maxLineWidth = H - 2 * margin; // in points (because line becomes vertical)
  const maxLinesPerPage = Math.floor((W - 2 * margin) / leading);

  const rot = direction === "cw" ? degrees(-90) : degrees(90);

  // Wrap a paragraph to fit maxLineWidth using actual font metrics
  function wrapToWidth(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";

    for (const w of words) {
      const candidate = line ? (line + " " + w) : w;
      const width = font.widthOfTextAtSize(candidate, fontSize);
      if (width <= maxLineWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        // If a single word is too long, hard-split it
        if (font.widthOfTextAtSize(w, fontSize) > maxLineWidth) {
          let chunk = "";
          for (const ch of w) {
            const cand2 = chunk + ch;
            if (font.widthOfTextAtSize(cand2, fontSize) <= maxLineWidth) chunk = cand2;
            else { lines.push(chunk); chunk = ch; }
          }
          line = chunk;
        } else {
          line = w;
        }
      }
    }

    if (line) lines.push(line);
    return lines;
  }

  // Turn each source page into a stream of wrapped lines
  const allPageLineBlocks = pagesText.map((txt, idx) => {
    const header = `${originalName} — extracted text (page ${idx + 1})`;
    const lines = [header, "-".repeat(Math.min(header.length, 80)), ""];

    // preserve blank lines
    const rawLines = (txt || "").split(/\r?\n/);
    for (const raw of rawLines) {
      const trimmed = raw.trim();
      if (!trimmed) { lines.push(""); continue; }
      lines.push(...wrapToWidth(trimmed));
    }
    return lines;
  });

  // Write lines sideways onto output pages
  for (let srcIdx = 0; srcIdx < allPageLineBlocks.length; srcIdx++) {
    const lines = allPageLineBlocks[srcIdx];
    let cursor = 0;

    while (cursor < lines.length) {
      const page = outPdf.addPage([W, H]);

      // Start at the right side and move left by leading each line.
      // Each "line" is drawn rotated 90°, so it reads normally when you rotate the paper.
      let x = W - margin;
      const y = margin;

      let linesUsed = 0;
      while (linesUsed < maxLinesPerPage && cursor < lines.length) {
        const lineText = lines[cursor] ?? "";
        page.drawText(lineText, {
          x,
          y,
          size: fontSize,
          font,
          rotate: rot,
        });
        x -= leading;
        linesUsed++;
        cursor++;
      }
    }
  }

  return await outPdf.save();
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
