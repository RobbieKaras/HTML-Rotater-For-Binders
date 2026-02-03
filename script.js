/* global PDFLib */
/* eslint-disable no-console */

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("file");
  const runBtn = document.getElementById("run");
  const statusEl = document.getElementById("status");
  const directionEl = document.getElementById("direction");
  const fontSizeEl = document.getElementById("fontsize");
  const leadingEl = document.getElementById("leading");

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  // If these are null, your HTML ids don't match.
  if (!fileInput || !runBtn || !statusEl) {
    console.error("Missing HTML elements. Check ids: file, run, status.");
    return;
  }

  // Always enable/disable button based on file selection (even if libraries fail)
  fileInput.addEventListener("change", () => {
    runBtn.disabled = !(fileInput.files && fileInput.files.length > 0);
    setStatus(runBtn.disabled ? "Choose a PDF to start." : "Ready ✅ Click “Make Sideways PDF”.");
  });

  // Try to set up PDF.js worker if pdfjsLib exists
  const pdfjsLib = window.pdfjsLib;
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";
  } else {
    // Don’t crash — just warn in the UI
    console.warn("pdfjsLib is not defined. PDF.js failed to load.");
    setStatus("PDF.js failed to load (check console). You can still select a file, but conversion won’t run.");
  }

  runBtn.addEventListener("click", async () => {
    try {
      const file = fileInput.files?.[0];
      if (!file) return;

      // If PDF.js didn’t load, tell you clearly (instead of silently doing nothing)
      if (!window.pdfjsLib) {
        setStatus("Error: PDF.js didn’t load. Open DevTools → Console to see the error.");
        return;
      }

      runBtn.disabled = true;
      setStatus(`Reading "${file.name}"...`);

      const arrayBuffer = await file.arrayBuffer();

      setStatus("Extracting text...");
      const pagesText = await extractTextByPage(arrayBuffer);

      setStatus("Generating sideways PDF...");
      const outBytes = await buildSidewaysTextPdf({
        pagesText,
        originalName: file.name,
        direction: directionEl.value,
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
      runBtn.disabled = !(fileInput.files && fileInput.files.length > 0);
    }
  });

  async function extractTextByPage(arrayBuffer) {
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      setStatus(`Extracting text... (page ${p}/${pdf.numPages})`);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();

      // Simple join — reliable baseline (we can improve ordering later)
      const text = tc.items
        .map(it => (it.str || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");

      pages.push(text.trim());
    }

    return pages;
  }

  async function buildSidewaysTextPdf({ pagesText, originalName, direction, fontSize, leading }) {
    const { PDFDocument, StandardFonts, degrees } = PDFLib;

    const outPdf = await PDFDocument.create();
    const font = await outPdf.embedFont(StandardFonts.Helvetica);

    // Letter portrait
    const W = 612;
    const H = 792;
    const margin = 0.6 * 72;

    // After rotation, "line width" is the tall dimension (H)
    const maxLineWidth = H - 2 * margin;
    const maxLinesPerPage = Math.floor((W - 2 * margin) / leading);

    const rot = direction === "cw" ? degrees(-90) : degrees(90);

    function wrapToWidth(text) {
      const words = text.split(/\s+/).filter(Boolean);
      const lines = [];
      let line = "";

      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        const width = font.widthOfTextAtSize(candidate, fontSize);
        if (width <= maxLineWidth) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          line = w;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    for (let i = 0; i < pagesText.length; i++) {
      const header = `${originalName} — extracted text (page ${i + 1})`;
      const lines = [header, "-".repeat(Math.min(header.length, 80)), "", ...wrapToWidth(pagesText[i] || "")];

      let cursor = 0;
      while (cursor < lines.length) {
        const page = outPdf.addPage([W, H]);

        let x = W - margin;
        const y = margin;

        let used = 0;
        while (used < maxLinesPerPage && cursor < lines.length) {
          page.drawText(lines[cursor] || "", { x, y, size: fontSize, font, rotate: rot });
          x -= leading;
          used++;
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
});

