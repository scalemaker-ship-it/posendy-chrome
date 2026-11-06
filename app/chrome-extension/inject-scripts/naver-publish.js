/* POSENDY → Naver Blog SmartEditor ONE publisher.
 *
 * Runs in the page's MAIN world on https://blog.naver.com/<blogId>/postwrite.
 * The background script first sets `window.__posendyJob` (see background/posendy/index.ts),
 * then injects this file. Progress and the final result land in `window.__posendyResult`.
 *
 * Job payload:
 *   { id, blogId, title, content (markdown), tags: string[], category?: string, openType?: 'public'|'private'|'neighbor',
 *     mode: 'publish'|'draft', media: [{ url, type: 'image'|'video', name? }] }
 *
 * Markdown subset → SmartEditor document JSON (schema measured 2026-08, see deajang/prd.md):
 *   # / ## heading   → quotation (default / underline layout)
 *   paragraph lines  → paragraph (center aligned, lineHeight 1.9)
 *   **bold**         → red bold node, ==mark== → yellow highlight, [text](url) → link node
 *   ![alt](url)      → uploaded image component (the file is fetched and dropped into the editor)
 *   | table |        → table component (GFM rows)
 *   > quote          → quotation (bubble not supported)
 *   - item           → paragraph with "• " prefix
 */
(function () {
  const job = window.__posendyJob;
  const result = (patch) => {
    window.__posendyResult = Object.assign(window.__posendyResult || { id: job && job.id }, patch);
  };
  if (!job) {
    result({ status: 'failed', error: 'no job payload' });
    return;
  }
  result({ status: 'running', step: 'start' });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BORDER_CELL = 'border-style: solid; border-width: 0px 1px 1px 0px; border-color: #000000;';
  const BORDER_TBL = 'border-style: solid; border-width: 1px 0px 0px 1px; border-color: #000000;';
  let seq = 0;
  const nid = () => 'SE-p' + Date.now().toString(36) + '-' + seq++;

  function textNode(value, o) {
    o = o || {};
    const style = { fontColor: o.color || '#141414', fontFamily: o.ff || 'nanumsquare', fontSizeCode: o.fs || 'fs16', '@ctype': 'nodeStyle' };
    if (o.bold) style.bold = true;
    if (o.bg) style.backgroundColor = o.bg;
    if (o.underline) style.underline = true;
    const node = { id: nid(), value: value, style: style, '@ctype': 'textNode' };
    if (o.link) {
      node.link = { url: o.link, '@ctype': 'urlLink' };
      style.fontColor = '#0000FF';
      style.underline = true;
    }
    return node;
  }
  /** inline markdown → nodes */
  function inline(text, base) {
    const nodes = [];
    const re = /(\*\*[^*]+\*\*|==[^=]+==|\[[^\]]+\]\([^)\s]+\)|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) nodes.push(textNode(text.slice(last, m.index), base));
      const t = m[0];
      if (t.startsWith('**')) nodes.push(textNode(t.slice(2, -2), Object.assign({}, base, { bold: true, color: '#FF0000' })));
      else if (t.startsWith('==')) nodes.push(textNode(t.slice(2, -2), Object.assign({}, base, { bg: '#FFE400' })));
      else if (t.startsWith('`')) nodes.push(textNode(t.slice(1, -1), Object.assign({}, base, { ff: 'nanumgothic', bg: '#F0F0F0' })));
      else {
        const lm = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(t);
        nodes.push(textNode(lm[1], Object.assign({}, base, { link: lm[2] })));
      }
      last = m.index + t.length;
    }
    if (last < text.length) nodes.push(textNode(text.slice(last), base));
    return nodes.length ? nodes : [textNode('', base)];
  }
  function para(text, o) {
    o = o || {};
    return { id: nid(), nodes: inline(text, o), style: { align: o.align || 'center', lineHeight: 1.9, '@ctype': 'paragraphStyle' }, '@ctype': 'paragraph' };
  }
  const textComp = (paras) => ({ id: nid(), layout: 'default', value: paras, '@ctype': 'text' });
  const gap = () => textComp([para(''), para('')]);
  const quote = (lines, layout, o) => ({ id: nid(), layout: layout || 'default', value: lines.map((l) => para(l, o)), source: null, align: 'center', '@ctype': 'quotation' });
  const cell = (text, o, width) => ({ id: nid(), borderInlineStyle: BORDER_CELL, colSpan: 1, rowSpan: 1, width: width, height: 43, backgroundColor: (o && o.bg) || undefined, value: [para(text, o)], '@ctype': 'tableCell' });
  const table = (rows, cols) => ({ id: nid(), layout: 'default', align: 'center', width: 100, rows: rows.map((cells) => ({ cells: cells, '@ctype': 'tableRow' })), columnCount: cols, borderStyleName: 'thinLine', borderInlineStyle: BORDER_TBL, '@ctype': 'table' });

  /** Block parser: returns [{t:'h1'|'h2'|'p'|'img'|'table'|'quote'|'list', ...}] */
  function parseBlocks(md) {
    const lines = md.replace(/\r/g, '').split('\n');
    const blocks = [];
    let i = 0;
    let paraLines = [];
    const flush = () => {
      if (paraLines.length) blocks.push({ t: 'p', lines: paraLines });
      paraLines = [];
    };
    while (i < lines.length) {
      const l = lines[i];
      const s = l.trim();
      if (!s) {
        flush();
        i++;
        continue;
      }
      let m;
      if ((m = /^(#{1,3})\s+(.+)$/.exec(s))) {
        flush();
        blocks.push({ t: m[1].length === 1 ? 'h1' : 'h2', text: m[2] });
        i++;
        continue;
      }
      if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(s))) {
        flush();
        blocks.push({ t: 'img', alt: m[1], url: m[2] });
        i++;
        continue;
      }
      if (s.startsWith('|')) {
        flush();
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const r = lines[i].trim();
          if (!/^\|\s*:?-+/.test(r)) rows.push(r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
          i++;
        }
        blocks.push({ t: 'table', rows: rows });
        continue;
      }
      if (s.startsWith('>')) {
        flush();
        const q = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          q.push(lines[i].trim().replace(/^>\s?/, '').replace(/\s*\{\.[^}]+\}\s*$/, ''));
          i++;
        }
        blocks.push({ t: 'quote', lines: q });
        continue;
      }
      if (/^(-|\*|\d+\.)\s+/.test(s)) {
        flush();
        const items = [];
        while (i < lines.length && /^(-|\*|\d+\.)\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^(-|\*|\d+\.)\s+/, ''));
          i++;
        }
        blocks.push({ t: 'list', items: items });
        continue;
      }
      if (/^#\S/.test(s) && /^(#\S+\s*)+$/.test(s)) {
        // trailing hashtag line → tags (handled by background), skip in body
        i++;
        continue;
      }
      paraLines.push(s);
      i++;
    }
    flush();
    return blocks;
  }

  /* ---------- editor access ---------- */
  function editor() {
    const se = window.SmartEditor;
    const key = se && se._editors && Object.keys(se._editors)[0];
    return key ? se._editors[key] : null;
  }
  async function waitEditor() {
    for (let k = 0; k < 120; k++) {
      const ed = editor();
      if (ed && ed._documentService && document.querySelector('.se-image-toolbar-button')) return ed;
      await sleep(500);
    }
    throw new Error('editor_not_ready');
  }

  /** Upload one image through the hidden file input without opening the OS dialog. */
  async function uploadImage(url, name) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('image_fetch_failed ' + res.status);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const file = new File([blob], name || 'posendy-' + seq++ + '.' + ext, { type: blob.type || 'image/jpeg' });
    const proto = HTMLInputElement.prototype;
    const origClick = proto.click;
    proto.click = function () {
      if (this.type === 'file') return; // swallow the native dialog
      return origClick.apply(this, arguments);
    };
    try {
      const btn = document.querySelector('.se-image-toolbar-button');
      if (!btn) throw new Error('image_button_missing');
      btn.click();
      let input = null;
      for (let k = 0; k < 40 && !input; k++) {
        await sleep(100);
        input = document.querySelector('input#hidden-file, input[type=file][accept*="image"]');
      }
      if (!input) throw new Error('file_input_missing');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      delete proto.click;
    }
    // wait until the editor holds an image component with this file name (Naver may swap the extension)
    const stem = file.name.replace(/\.[^.]+$/, '');
    for (let k = 0; k < 100; k++) {
      await sleep(300);
      const comps = editor()._documentService.getDocumentData().document.components;
      const img = comps.find((c) => c['@ctype'] === 'image' && typeof c.fileName === 'string' && c.fileName.replace(/\.[^.]+$/, '') === stem && c.src);
      if (img) return img;
    }
    throw new Error('image_upload_timeout');
  }

  /** "작성 중인 글이 있습니다" (restore previous draft) → 취소, we always start from the job content. */
  async function dismissRestoreDialog(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 4000)) {
      const btn = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent && b.textContent.trim() === '취소').find((b) => {
        let e = b;
        for (let i = 0; i < 10 && e; i++) {
          if (e.innerText && e.innerText.indexOf('작성 중인 글') >= 0) return true;
          e = e.parentElement;
        }
        return false;
      });
      if (btn) {
        btn.click();
        await sleep(500);
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  function placeCursorInBody(ed) {
    try {
      const p = document.querySelector('.se-component.se-text .se-text-paragraph');
      if (p) {
        const r = document.createRange();
        r.selectNodeContents(p);
        r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        p.focus && p.focus();
      }
    } catch (e) {
      /* ignore */
    }
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Naver drops the session sometimes ("로그인이 필요합니다"); the person must log in, we park the job. */
  function loginRequired() {
    return document.body.innerText.indexOf('로그인이 필요합니다') >= 0 || /nid\.naver\.com/.test(location.href);
  }
  const loginWatch = setInterval(() => {
    if (loginRequired() && (window.__posendyResult || {}).status === 'running') {
      result({ status: 'needs_login', error: '네이버 로그인이 풀렸어요. 열린 탭에서 로그인한 뒤 다시 올라가요.' });
      clearInterval(loginWatch);
    }
  }, 1000);

  async function run() {
    if (loginRequired()) throw Object.assign(new Error('login_required'), { login: true });
    await dismissRestoreDialog(3000);
    const ed = await waitEditor();
    const ds = ed._documentService;
    await dismissRestoreDialog(2500);
    result({ step: 'editor_ready' });

    // 1) upload images referenced in the body (and extra media that are images)
    const blocks = parseBlocks(job.content || '');
    const imgUrls = blocks.filter((b) => b.t === 'img').map((b) => b.url);
    (job.media || []).forEach((m) => {
      if (m.type === 'image' && !imgUrls.includes(m.url)) {
        imgUrls.push(m.url);
        blocks.push({ t: 'img', alt: m.name || '', url: m.url });
      }
    });
    const uploaded = {};
    placeCursorInBody(ed);
    for (let k = 0; k < imgUrls.length; k++) {
      result({ step: 'upload ' + (k + 1) + '/' + imgUrls.length });
      try {
        uploaded[imgUrls[k]] = await uploadImage(imgUrls[k], 'posendy-' + String(k + 1).padStart(2, '0') + '.jpg');
      } catch (e) {
        result({ warn: 'image skipped: ' + (e && e.message) });
      }
      await sleep(600);
    }

    // 2) build the document
    const base = JSON.parse(JSON.stringify(ds.getDocumentData()));
    const titleComp = base.document.components.find((c) => c['@ctype'] === 'documentTitle');
    const C = [];
    let firstImage = null;
    blocks.forEach((b, idx) => {
      if (b.t === 'h1') C.push(quote([b.text], 'default', { fs: 'fs24', bold: true }));
      else if (b.t === 'h2') C.push(quote([b.text], 'quotation_underline', { fs: 'fs19', bold: true }));
      else if (b.t === 'quote') C.push(quote(b.lines, 'default', {}));
      else if (b.t === 'p') C.push(textComp(b.lines.map((l) => para(l.replace(/\s*\{\.[^}]+\}\s*$/, ''))).concat(idx < blocks.length - 1 ? [para('')] : [])));
      else if (b.t === 'list') C.push(textComp(b.items.map((l) => para('• ' + l, { align: 'left' })).concat([para('')])));
      else if (b.t === 'table' && b.rows.length) {
        const cols = Math.max.apply(null, b.rows.map((r) => r.length));
        const w = Math.round((100 / cols) * 100) / 100;
        C.push(table(b.rows.map((r, ri) => r.map((c) => cell(c, ri === 0 ? { bg: '#F5C400', bold: true } : {}, w))), cols));
        C.push(gap());
      } else if (b.t === 'img') {
        const src = uploaded[b.url];
        if (src) {
          const img = JSON.parse(JSON.stringify(src));
          img.id = nid();
          img.align = 'center';
          if (b.alt) img.caption = { id: nid(), nodes: [textNode(b.alt, { fs: 'fs13', color: '#666666' })], style: { align: 'center', '@ctype': 'paragraphStyle' }, '@ctype': 'paragraph' };
          if (!firstImage) firstImage = img;
          C.push(img, gap());
        }
      }
    });
    if (firstImage) firstImage.represent = true;
    titleComp.title = [{ id: nid(), nodes: [textNode(job.title || '', {})], style: { align: 'center', '@ctype': 'paragraphStyle' }, '@ctype': 'paragraph' }];
    base.document.components = [titleComp].concat(C.length ? C : [textComp([para('')])]);
    ds.setDocumentData(base);
    await sleep(1500);
    result({ step: 'document_set', components: C.length });

    // 3) draft = top "저장" button (no publish panel); publish = panel with category, open type, tags
    if (job.mode === 'draft') {
      const saveBtn = Array.from(document.querySelectorAll('button[class*="save_btn"]')).find((b) => !/count/.test(b.className) && b.offsetParent);
      if (!saveBtn) throw new Error('save_button_missing');
      saveBtn.click();
      await sleep(2000);
      result({ status: 'done', mode: 'draft', url: location.href });
      return;
    }
    const publishBtn = document.querySelector('button[class*="publish_btn"]');
    if (!publishBtn) throw new Error('publish_button_missing');
    publishBtn.click();
    await sleep(1500);

    if (job.category) {
      const box = document.querySelector('[class*="option_category"]');
      const catBtn = box && box.querySelector('button');
      if (catBtn) {
        catBtn.click();
        await sleep(600);
        const want = job.category.replace(/\s+/g, '');
        const labels = Array.from(box.querySelectorAll('label'));
        const hit = labels.find((l) => l.textContent.replace(/하위 카테고리/g, '').replace(/\s+/g, '') === want);
        if (hit) hit.click();
        else {
          result({ warn: 'category not found: ' + job.category });
          catBtn.click();
        }
        await sleep(400);
      }
    }
    if (job.openType && job.openType !== 'public') {
      const labels = Array.from(document.querySelectorAll('label'));
      const want = job.openType === 'private' ? /^비공개$/ : /^이웃공개$/;
      const hit = labels.find((l) => want.test(l.textContent.trim()));
      if (hit) hit.click();
    }
    const tagInput = document.querySelector('#tag-input, input[id*="tag"]');
    if (tagInput && job.tags && job.tags.length) {
      for (const t of job.tags.slice(0, 30)) {
        setNativeValue(tagInput, t.replace(/^#/, ''));
        tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        tagInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(150);
      }
    }
    result({ step: 'panel_filled' });
    const confirm = document.querySelector('button[class*="confirm_btn"]');
    if (!confirm) throw new Error('confirm_button_missing');
    confirm.click();
    result({ step: 'publish_clicked' });
    // The page navigates to the new post; the background script reads the final URL from the tab.
  }

  run()
    .then(() => clearInterval(loginWatch))
    .catch((e) => {
      clearInterval(loginWatch);
      if (e && e.login) result({ status: 'needs_login', error: '네이버 로그인이 필요해요. 열린 탭에서 로그인해 주세요.' });
      else if ((window.__posendyResult || {}).status !== 'needs_login') result({ status: 'failed', error: (e && e.message) || String(e) });
    });
})();
