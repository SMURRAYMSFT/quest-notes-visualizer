/* Zero-dependency .docx reader.
   Unzips with the browser's native DecompressionStream and pulls a simple
   block list (headings / paragraphs / list items) out of word/document.xml. */
(function (global) {
  'use strict';

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  /* ---------- minimal ZIP reader ---------- */

  function findEOCD(view, len) {
    const max = Math.min(len, 66000);
    for (let i = len - 22; i >= len - max && i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot unzip .docx files. Use a recent Chrome, Edge or Firefox.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const eocd = findEOCD(view, view.byteLength);
    if (eocd < 0) throw new Error('Not a valid .docx file (no ZIP directory found).');

    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = new Map();

    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOff = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
      files.set(name, { method, compSize, localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }

    return {
      has: (name) => files.has(name),
      names: () => [...files.keys()],
      async text(name) {
        const e = files.get(name);
        if (!e) return null;
        const nameLen = view.getUint16(e.localOff + 26, true);
        const extraLen = view.getUint16(e.localOff + 28, true);
        const start = e.localOff + 30 + nameLen + extraLen;
        const raw = bytes.subarray(start, start + e.compSize);
        const out = e.method === 0 ? raw : await inflateRaw(raw);
        return new TextDecoder('utf-8').decode(out);
      }
    };
  }

  /* ---------- WordprocessingML -> blocks ---------- */

  function runText(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      const n = child.localName;
      if (n === 't') out += child.textContent;
      else if (n === 'tab') out += '\t';
      else if (n === 'br' || n === 'cr') out += ' ';
      else if (n === 'noBreakHyphen') out += '-';
      else out += runText(child);
    }
    return out;
  }

  function firstChild(node, name) {
    for (const c of node.childNodes) if (c.nodeType === 1 && c.localName === name) return c;
    return null;
  }

  function paragraphBlock(p) {
    const text = runText(p).replace(/\s+/g, ' ').trim();
    const pPr = firstChild(p, 'pPr');
    let style = '', listLevel = -1, outline = -1;

    if (pPr) {
      const st = firstChild(pPr, 'pStyle');
      if (st) style = (st.getAttributeNS(W, 'val') || st.getAttribute('w:val') || '').trim();
      const num = firstChild(pPr, 'numPr');
      if (num) {
        const ilvl = firstChild(num, 'ilvl');
        const v = ilvl && (ilvl.getAttributeNS(W, 'val') || ilvl.getAttribute('w:val'));
        listLevel = v ? parseInt(v, 10) || 0 : 0;
      }
      const ol = firstChild(pPr, 'outlineLvl');
      if (ol) {
        const v = ol.getAttributeNS(W, 'val') || ol.getAttribute('w:val');
        outline = v ? parseInt(v, 10) : -1;
      }
    }

    const flat = style.toLowerCase().replace(/[\s-]/g, '');
    let level = 0;
    const m = /^heading(\d)$/.exec(flat);
    if (m) level = parseInt(m[1], 10);
    else if (flat === 'title') level = 1;
    else if (flat === 'subtitle') level = 2;
    else if (outline >= 0 && outline < 6) level = outline + 1;

    if (!text) return null;
    if (level > 0) return { type: 'heading', level, text };
    if (listLevel >= 0 || flat === 'listparagraph') {
      return { type: 'item', level: Math.max(0, listLevel), text };
    }
    return { type: 'para', text };
  }

  function walkBody(body, blocks) {
    for (const node of body.childNodes) {
      if (node.nodeType !== 1) continue;
      if (node.localName === 'p') {
        const b = paragraphBlock(node);
        if (b) blocks.push(b);
      } else if (node.localName === 'tbl') {
        for (const row of node.childNodes) {
          if (row.nodeType !== 1 || row.localName !== 'tr') continue;
          const cells = [];
          for (const cell of row.childNodes) {
            if (cell.nodeType !== 1 || cell.localName !== 'tc') continue;
            cells.push(runText(cell).replace(/\s+/g, ' ').trim());
          }
          const text = cells.filter(Boolean).join(': ');
          if (text) blocks.push({ type: 'item', level: 0, text });
        }
      } else if (node.localName === 'sdt') {
        const content = firstChild(node, 'sdtContent');
        if (content) walkBody(content, blocks);
      }
    }
  }

  async function docxToBlocks(buffer) {
    const zip = await readZip(buffer);
    const name = zip.has('word/document.xml')
      ? 'word/document.xml'
      : zip.names().find((n) => /^word\/document\d*\.xml$/.test(n));
    if (!name) throw new Error('That ZIP does not look like a Word document.');

    const xml = await zip.text(name);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Could not read the Word XML.');

    const body = doc.getElementsByTagNameNS(W, 'body')[0] || doc.documentElement;
    const blocks = [];
    walkBody(body, blocks);
    return blocks;
  }

  /* ---------- plain text / markdown -> blocks ---------- */

  function textToBlocks(text) {
    const blocks = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) continue;
      const h = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
      const li = /^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        blocks.push({ type: 'item', level: Math.floor(li[1].replace(/\t/g, '  ').length / 2), text: li[2].trim() });
        continue;
      }
      blocks.push({ type: 'para', text: line.trim() });
    }
    return blocks;
  }

  global.DocReader = { docxToBlocks, textToBlocks };
})(window);
