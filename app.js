/* Quest Journal — turns a Word/Markdown/text note file into Skyrim-style quests. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const STORE_KEY = 'questJournal.v1';
  const state = {
    quests: [],
    selectedId: null,
    filter: 'active',
    query: '',
    toggles: {},
    sourceName: null
  };

  /* ---------------- persistence ---------------- */

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      state.toggles = raw.toggles || {};
      state.filter = raw.filter || 'active';
      state.selectedId = raw.selectedId || null;
    } catch { /* ignore corrupt state */ }
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      toggles: state.toggles, filter: state.filter, selectedId: state.selectedId
    }));
  }

  function idbHandle(mode, value) {
    return new Promise((resolve) => {
      const req = indexedDB.open('questJournal', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('handles', mode === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('handles');
        const op = mode === 'get' ? store.get('doc') : store.put(value, 'doc');
        op.onsuccess = () => resolve(mode === 'get' ? op.result : true);
        op.onerror = () => resolve(null);
      };
    });
  }

  /* ---------------- parsing ---------------- */

  const META_KEYS = {
    type: 'type', questtype: 'type', category: 'type',
    level: 'level', difficulty: 'level',
    giver: 'giver', questgiver: 'giver', from: 'giver',
    location: 'location', place: 'location', region: 'location',
    reward: 'reward', rewards: 'reward', loot: 'reward',
    requires: 'requires', requires_: 'requires', prereq: 'requires',
    prerequisite: 'requires', after: 'requires', follows: 'requires',
    status: 'status', state: 'status', due: 'due', deadline: 'due'
  };

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function takeMeta(text) {
    const m = /^([A-Za-z][A-Za-z _-]{1,20})\s*:\s*(.+)$/.exec(text);
    if (!m) return null;
    const key = META_KEYS[m[1].toLowerCase().replace(/[\s_-]/g, '')];
    return key ? { key, value: m[2].trim() } : null;
  }

  function parseObjective(text) {
    const obj = { text, done: false, optional: false, tags: [], location: null };
    let t = text;

    const mark = /^\s*(?:\[\s*([xX✓v])\s*\]|\[\s*\]|\[(done|complete[d]?)\]|[✓✔]|\u2611)\s*/.exec(t);
    if (mark) { obj.done = !/^\s*\[\s*\]/.test(t); t = t.slice(mark[0].length); }
    if (/\((optional|opt)\)/i.test(t)) { obj.optional = true; t = t.replace(/\s*\((optional|opt)\)\s*/i, ' '); }
    if (/\b(done|completed)\s*$/i.test(t) && /[—–-]\s*(done|completed)\s*$/i.test(t)) {
      obj.done = true; t = t.replace(/\s*[—–-]\s*(done|completed)\s*$/i, '');
    }

    t = t.replace(/@([\w'&./-]{2,})/g, (_, loc) => { obj.location = loc.replace(/[._-]+/g, ' '); return ''; });
    t = t.replace(/#([\w-]{2,})/g, (_, tag) => { obj.tags.push(tag.replace(/-/g, ' ')); return ''; });

    obj.text = t.replace(/\s{2,}/g, ' ').trim() || text.trim();
    return obj;
  }

  function newQuest(title) {
    return {
      id: slug(title) || 'quest-' + Math.random().toString(36).slice(2, 7),
      title, type: null, level: null, giver: null, location: null,
      reward: null, requires: [], status: null, due: null,
      description: [], stages: [], tags: []
    };
  }

  function stageOf(quest, title) {
    if (!quest.stages.length || (title != null && quest.stages[quest.stages.length - 1].title !== title)) {
      quest.stages.push({ title, description: [], objectives: [] });
    }
    return quest.stages[quest.stages.length - 1];
  }

  function applyMeta(target, meta) {
    if (meta.key === 'requires') {
      target.requires = meta.value.split(/[,;]|\band\b/i).map((s) => s.trim()).filter(Boolean);
    } else {
      target[meta.key] = meta.value;
    }
  }

  function blocksToQuests(blocks) {
    const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.level);
    const questLevel = headings.length ? Math.min(...headings) : 1;
    const deeper = headings.filter((l) => l > questLevel);
    const stageLevel = deeper.length ? Math.min(...deeper) : questLevel + 1;

    const quests = [];
    let quest = null;

    for (const b of blocks) {
      if (b.type === 'heading' && b.level <= questLevel) {
        quest = newQuest(b.text);
        quests.push(quest);
        continue;
      }
      if (!quest) {
        if (b.type === 'heading') { quest = newQuest(b.text); quests.push(quest); }
        continue;
      }
      if (b.type === 'heading' && b.level >= stageLevel) {
        quest.stages.push({ title: b.text, description: [], objectives: [] });
        continue;
      }

      const meta = takeMeta(b.text);
      if (meta) { applyMeta(quest, meta); continue; }

      if (b.type === 'item') {
        const obj = parseObjective(b.text);
        obj.indent = Math.min(b.level || 0, 3);
        stageOf(quest, quest.stages.length ? quest.stages[quest.stages.length - 1].title : null)
          .objectives.push(obj);
        for (const tag of obj.tags) if (!quest.tags.includes(tag)) quest.tags.push(tag);
      } else {
        const target = quest.stages.length ? quest.stages[quest.stages.length - 1] : quest;
        target.description.push(b.text);
      }
    }

    for (const q of quests) {
      if (!q.type) q.type = /main/i.test(q.tags.join(' ')) ? 'Main' : 'Side';
      q.stages = q.stages.filter((s) => s.title || s.objectives.length || s.description.length);
    }
    return quests;
  }

  /* ---------------- derived state ---------------- */

  const objKey = (q, si, oi, text) => `${q.id}|${si}|${oi}|${text.slice(0, 40)}`;

  function isDone(q, si, oi, obj) {
    const k = objKey(q, si, oi, obj.text);
    return k in state.toggles ? state.toggles[k] : obj.done;
  }

  function progress(q) {
    let total = 0, done = 0;
    q.stages.forEach((s, si) => s.objectives.forEach((o, oi) => {
      if (o.optional) return;
      total++;
      if (isDone(q, si, oi, o)) done++;
    }));
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function questStatus(q) {
    if (q.status && /complete|done|finished/i.test(q.status)) return 'completed';
    const p = progress(q);
    return p.total > 0 && p.done === p.total ? 'completed' : 'active';
  }

  function matchesQuery(q) {
    if (!state.query) return true;
    const hay = [q.title, q.type, q.location, q.giver, q.reward, q.tags.join(' '),
      ...q.stages.map((s) => [s.title, ...s.description, ...s.objectives.map((o) => o.text)].join(' '))]
      .join(' ').toLowerCase();
    return hay.includes(state.query);
  }

  function visibleQuests() {
    return state.quests.filter((q) => {
      if (!matchesQuery(q)) return false;
      if (state.filter === 'all') return true;
      return questStatus(q) === state.filter;
    });
  }

  /* ---------------- rendering ---------------- */

  function typeClass(t) {
    const v = (t || '').toLowerCase();
    if (v.includes('main')) return 'main';
    if (v.includes('faction') || v.includes('guild')) return 'faction';
    if (v.includes('misc')) return 'misc';
    if (v.includes('daedr') || v.includes('urgent')) return 'daedric';
    return 'side';
  }

  function renderList() {
    const list = $('#questList');
    list.textContent = '';
    const quests = visibleQuests();

    if (!quests.length) {
      const li = el('li', 'quest-empty', state.quests.length
        ? 'No quests match this filter.'
        : 'Journal is empty — connect a document.');
      list.appendChild(li);
    }

    for (const q of quests) {
      const p = progress(q);
      const status = questStatus(q);
      const li = el('li', 'quest-item' + (q.id === state.selectedId ? ' selected' : '') +
        (status === 'completed' ? ' done' : ''));
      li.tabIndex = 0;

      const row = el('div', 'qi-row');
      row.appendChild(el('span', 'qi-marker', status === 'completed' ? '✓' : '◆'));
      row.appendChild(el('span', 'qi-title', q.title));
      li.appendChild(row);

      const meta = el('div', 'qi-meta');
      meta.appendChild(el('span', 'chip ' + typeClass(q.type), q.type || 'Side'));
      if (q.location) meta.appendChild(el('span', 'chip loc', q.location));
      if (p.total) meta.appendChild(el('span', 'chip count', `${p.done}/${p.total}`));
      li.appendChild(meta);

      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill');
      fill.style.width = p.pct + '%';
      bar.appendChild(fill);
      li.appendChild(bar);

      const pick = () => { state.selectedId = q.id; saveState(); render(); };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      list.appendChild(li);
    }

    const totalDone = state.quests.filter((q) => questStatus(q) === 'completed').length;
    $('#listStats').textContent = state.quests.length
      ? `${quests.length} shown · ${totalDone} of ${state.quests.length} complete`
      : '';
  }

  function metaRow(label, value) {
    const row = el('div', 'meta-row');
    row.appendChild(el('span', 'meta-k', label));
    row.appendChild(el('span', 'meta-v', value));
    return row;
  }

  function renderDetail() {
    const panel = $('#detail');
    panel.textContent = '';
    const q = state.quests.find((x) => x.id === state.selectedId);

    if (!q) {
      const empty = el('div', 'empty');
      empty.appendChild(el('div', 'emblem', '❖'));
      empty.appendChild(el('h2', null, state.quests.length ? 'Select a quest' : 'No quest selected'));
      empty.appendChild(el('p', null, state.quests.length
        ? 'Choose an entry from the journal on the left.'
        : 'Connect a Word document to populate your journal, or load the demo to see how notes become quests.'));
      panel.appendChild(empty);
      return;
    }

    const p = progress(q);
    const head = el('header', 'detail-head');
    head.appendChild(el('div', 'detail-type ' + typeClass(q.type), (q.type || 'Side') + ' Quest'));
    head.appendChild(el('h2', 'detail-title', q.title));

    const metas = el('div', 'detail-meta');
    if (q.level) metas.appendChild(metaRow('Level', q.level));
    if (q.giver) metas.appendChild(metaRow('Giver', q.giver));
    if (q.location) metas.appendChild(metaRow('Location', q.location));
    if (q.due) metas.appendChild(metaRow('Due', q.due));
    if (q.requires.length) metas.appendChild(metaRow('Requires', q.requires.join(', ')));
    if (metas.children.length) head.appendChild(metas);

    const prog = el('div', 'detail-progress');
    const bar = el('div', 'bar big');
    const fill = el('div', 'bar-fill');
    fill.style.width = p.pct + '%';
    bar.appendChild(fill);
    prog.appendChild(bar);
    prog.appendChild(el('span', 'pct', p.total ? `${p.done}/${p.total} objectives · ${p.pct}%` : 'No objectives'));
    head.appendChild(prog);
    panel.appendChild(head);

    const body = el('div', 'detail-body');
    for (const line of q.description) body.appendChild(el('p', 'quest-desc', line));

    q.stages.forEach((stage, si) => {
      const sec = el('section', 'stage');
      if (stage.title) {
        const h = el('h3', 'stage-title');
        h.appendChild(el('span', 'stage-rune', '◈'));
        h.appendChild(el('span', null, stage.title));
        const sTotal = stage.objectives.filter((o) => !o.optional).length;
        const sDone = stage.objectives.filter((o, oi) => !o.optional && isDone(q, si, oi, o)).length;
        if (sTotal) h.appendChild(el('span', 'stage-count', `${sDone}/${sTotal}`));
        if (sTotal && sDone === sTotal) sec.classList.add('stage-done');
        sec.appendChild(h);
      }
      for (const line of stage.description) sec.appendChild(el('p', 'stage-desc', line));

      if (stage.objectives.length) {
        const ul = el('ul', 'objectives');
        stage.objectives.forEach((o, oi) => {
          const done = isDone(q, si, oi, o);
          const li = el('li', 'objective' + (done ? ' done' : '') + (o.optional ? ' optional' : ''));
          li.style.marginLeft = (o.indent || 0) * 18 + 'px';

          const box = el('button', 'obj-box');
          box.type = 'button';
          box.setAttribute('aria-pressed', String(done));
          box.textContent = done ? '✓' : '';
          box.addEventListener('click', () => {
            state.toggles[objKey(q, si, oi, o.text)] = !done;
            saveState();
            render();
          });
          li.appendChild(box);

          const txt = el('span', 'obj-text', o.text);
          li.appendChild(txt);
          if (o.optional) li.appendChild(el('span', 'chip opt', 'optional'));
          if (o.location) li.appendChild(el('span', 'chip loc', o.location));
          for (const tag of o.tags) li.appendChild(el('span', 'chip tag', '#' + tag));
          ul.appendChild(li);
        });
        sec.appendChild(ul);
      }
      body.appendChild(sec);
    });

    if (q.reward) {
      const r = el('div', 'reward');
      r.appendChild(el('span', 'reward-rune', '✦'));
      r.appendChild(el('span', null, 'Reward: ' + q.reward));
      body.appendChild(r);
    }

    if (q.tags.length) {
      const tags = el('div', 'tag-row');
      for (const t of q.tags) tags.appendChild(el('span', 'chip tag', '#' + t));
      body.appendChild(tags);
    }

    panel.appendChild(body);
  }

  function findByName(name) {
    const s = slug(name);
    return state.quests.find((q) => q.id === s) ||
      state.quests.find((q) => q.title.toLowerCase() === name.toLowerCase()) ||
      state.quests.find((q) => q.title.toLowerCase().includes(name.toLowerCase()));
  }

  function chainFor(q) {
    const before = [];
    let cur = q, guard = 0;
    while (cur && cur.requires.length && guard++ < 20) {
      const prev = findByName(cur.requires[0]);
      if (!prev || before.includes(prev) || prev === q) break;
      before.unshift(prev);
      cur = prev;
    }
    const after = [];
    let frontier = [q];
    for (let d = 0; d < 20 && frontier.length; d++) {
      const next = state.quests.filter((o) =>
        !after.includes(o) && o !== q && !before.includes(o) &&
        o.requires.some((r) => frontier.some((f) => findByName(r) === f)));
      if (!next.length) break;
      after.push(...next);
      frontier = next;
    }
    return [...before, q, ...after];
  }

  function renderMap() {
    const body = $('#mapBody');
    body.textContent = '';
    const q = state.quests.find((x) => x.id === state.selectedId);
    if (!q) {
      body.appendChild(el('p', 'map-empty', 'Select a quest to trace its line.'));
      return;
    }
    const chain = chainFor(q);
    if (chain.length < 2) {
      body.appendChild(el('p', 'map-empty', 'This quest stands alone. Add “Requires: <quest>” to your notes to link quests together.'));
    }

    chain.forEach((node, i) => {
      if (i) body.appendChild(el('div', 'map-link', '│'));
      const status = questStatus(node);
      const n = el('button', 'map-node ' + typeClass(node.type) +
        (node.id === q.id ? ' current' : '') + (status === 'completed' ? ' done' : ''));
      n.type = 'button';
      n.appendChild(el('span', 'map-rune', status === 'completed' ? '✓' : '◆'));
      n.appendChild(el('span', 'map-title', node.title));
      const pr = progress(node);
      if (pr.total) n.appendChild(el('span', 'map-count', `${pr.done}/${pr.total}`));
      n.addEventListener('click', () => { state.selectedId = node.id; saveState(); render(); });
      body.appendChild(n);
    });

    const stages = q.stages.filter((s) => s.title);
    if (stages.length) {
      body.appendChild(el('h4', 'map-sub', 'Stages'));
      const ol = el('ol', 'map-stages');
      stages.forEach((s) => {
        const si = q.stages.indexOf(s);
        const total = s.objectives.filter((o) => !o.optional).length;
        const done = s.objectives.filter((o, oi) => !o.optional && isDone(q, si, oi, o)).length;
        const li = el('li', 'map-stage' + (total && done === total ? ' done' : ''));
        li.appendChild(el('span', 'map-stage-title', s.title));
        if (total) li.appendChild(el('span', 'map-count', `${done}/${total}`));
        ol.appendChild(li);
      });
      body.appendChild(ol);
    }
  }

  function render() {
    if (state.selectedId && !state.quests.some((q) => q.id === state.selectedId)) state.selectedId = null;
    renderList();
    renderDetail();
    renderMap();
    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.filter === state.filter);
    }
    $('#srcName').textContent = state.sourceName || 'No document connected';
  }

  /* ---------------- loading documents ---------------- */

  function setQuests(quests, sourceName) {
    state.quests = quests;
    state.sourceName = sourceName;
    if (!state.selectedId || !quests.some((q) => q.id === state.selectedId)) {
      const firstActive = quests.find((q) => questStatus(q) === 'active') || quests[0];
      state.selectedId = firstActive ? firstActive.id : null;
    }
    saveState();
    render();
  }

  function toast(msg, isError) {
    const t = el('div', 'toast' + (isError ? ' error' : ''), msg);
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4200);
  }

  async function blocksFromFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) return DocReader.docxToBlocks(await file.arrayBuffer());
    if (name.endsWith('.doc')) throw new Error('Legacy .doc is not supported — save as .docx.');
    return DocReader.textToBlocks(await file.text());
  }

  async function loadFile(file) {
    try {
      const blocks = await blocksFromFile(file);
      const quests = blocksToQuests(blocks);
      if (!quests.length) {
        toast('No headings found in that document — add Heading 1 titles for each quest.', true);
        return;
      }
      setQuests(quests, file.name);
      toast(`Loaded ${quests.length} quest${quests.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not read that file.', true);
    }
  }

  let fileHandle = null;

  async function connect() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'Quest notes',
            accept: {
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
              'text/plain': ['.txt', '.md', '.markdown']
            }
          }]
        });
        fileHandle = handle;
        await idbHandle('put', handle);
        $('#btnRefresh').disabled = false;
        await loadFile(await handle.getFile());
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const input = el('input');
    input.type = 'file';
    input.accept = '.docx,.txt,.md,.markdown';
    input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });
    input.click();
  }

  async function refresh() {
    if (!fileHandle) return;
    try {
      if (fileHandle.queryPermission) {
        let perm = await fileHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await fileHandle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') { toast('Permission to read the document was denied.', true); return; }
      }
      await loadFile(await fileHandle.getFile());
    } catch (err) {
      console.error(err);
      toast('Could not re-read the document. Reconnect it.', true);
    }
  }

  async function loadFromUrl(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'document');
      await loadFile(new File([blob], name));
      return true;
    } catch (err) {
      console.error(err);
      toast('Could not fetch ' + url + ' — ' + err.message, true);
      return false;
    }
  }

  async function restoreHandle() {
    if (!window.showOpenFilePicker) return;
    const handle = await idbHandle('get');
    if (!handle) return;
    fileHandle = handle;
    $('#btnRefresh').disabled = false;
    state.sourceName = handle.name + ' (click Refresh to load)';
    render();
    if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) === 'granted') {
      await loadFile(await handle.getFile());
    }
  }

  /* ---------------- demo data ---------------- */

  const DEMO = `# Before the Storm
Type: Main
Level: 4
Giver: Jarl Balgruuf
Location: Dragonsreach, Whiterun
Requires:
Word of the dragon attack at Helgen must reach the Jarl before the hold is caught unaware.
## Reach Whiterun
- [x] Travel the road north from Riverwood @Whiterun
- [x] Speak with the guards at the gate #diplomacy
## Deliver the warning
- Inform Jarl Balgruuf of the dragon attack
- Agree to help the court wizard (optional)
Reward: Favour of the Jarl, access to Dragonsreach

# Bleak Falls Barrow
Type: Main
Level: 6
Giver: Farengar Secret-Fire
Location: Bleak Falls Barrow
Requires: Before the Storm
Retrieve the Dragonstone — a map of ancient dragon burial sites.
## Enter the barrow
- [x] Climb the mountain path above Riverwood @Riverwood
- Clear the bandit camp at the entrance #combat
## The inner sanctum
- Solve the pillar puzzle
- Defeat the draugr overlord
- Recover the Dragonstone
- Search the side chamber for loot (optional)
Reward: Dragonstone, Gold

# The Way of the Voice
Type: Main
Level: 10
Giver: The Greybeards
Location: High Hrothgar
Requires: Bleak Falls Barrow
## Climb the Seven Thousand Steps
- Follow the pilgrim's path @Ivarstead
- Read the ten tablets along the way (optional)
## Training
- Learn the shout Unrelenting Force
- Retrieve the Horn of Jurgen Windcaller
Reward: Thu'um training

# Thieves' Cache
Type: Faction
Level: 8
Giver: Brynjolf
Location: Riften
## Preparation
- [x] Meet Brynjolf in the market @Riften
- Case the strongbox #stealth
## The job
- Plant the ring on Brand-Shei
- Escape without being seen (optional)
Reward: 100 gold, Guild contact

# Gather Alchemy Reagents
Type: Misc
Location: Eastmarch
- Collect 5 mountain flowers #gathering
- Collect 3 blue butterfly wings
- [x] Buy an empty mortar @Windhelm
`;

  /* ---------------- wiring ---------------- */

  function init() {
    loadState();

    $('#btnConnect').addEventListener('click', connect);
    $('#btnRefresh').addEventListener('click', refresh);
    $('#btnSample').addEventListener('click', () => {
      setQuests(blocksToQuests(DocReader.textToBlocks(DEMO)), 'Demo quest notes');
      toast('Loaded the demo journal.');
    });
    $('#btnHelp').addEventListener('click', () => $('#helpDlg').showModal());
    $('#helpClose').addEventListener('click', () => $('#helpDlg').close());

    $('#search').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      renderList();
    });

    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => { state.filter = tab.dataset.filter; saveState(); render(); });
    }

    document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
    document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragging'); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      document.body.classList.remove('dragging');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    render();

    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      setQuests(blocksToQuests(DocReader.textToBlocks(DEMO)), 'Demo quest notes');
    } else if (params.get('doc')) {
      loadFromUrl(params.get('doc'));
    } else {
      restoreHandle();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
