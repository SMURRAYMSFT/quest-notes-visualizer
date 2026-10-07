# Quest Notes Visualizer

A Skyrim-style quest journal that renders a Word document of notes as quests, stages and objectives. Pure HTML/CSS/JS — no build step, no dependencies, no network calls.

## Run it

Double-click `index.html`, or for the full experience (live **Refresh** of the connected document):

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\serve.ps1
# then open http://127.0.0.1:8731/
```

Click **Connect Document** and pick a `.docx` (or `.md` / `.txt`), or drag the file onto the window. **Demo** loads built-in sample quests. `Sample Quest Notes.docx` is a ready-made example — regenerate it with `tools\make-sample-docx.ps1`.

URL shortcuts: `index.html?demo=1` and `index.html?doc=<relative-or-absolute-url>`.

## How notes become quests

| In your document | Becomes |
| --- | --- |
| Heading 1 | A quest |
| Heading 2 | A stage / sub-quest |
| Bullet or numbered list item | An objective |
| Plain paragraph | Quest or stage description |

Inline markers, usable anywhere:

- `[x]`, `[done]`, `✓` at the start of an objective → already complete
- `(optional)` → optional objective (excluded from progress)
- `@Location` → location chip, `#tag` → tag chip
- `Type:` Main / Side / Faction / Misc, plus `Level:`, `Giver:`, `Location:`, `Reward:`, `Status:`, `Due:`
- `Requires: Another Quest` → links quests into a quest line, drawn in the right panel

Markdown and plain text follow the same rules using `#`, `##`, `-` and `- [x]`.

## Behaviour notes

- Ticking an objective is stored in `localStorage`, keyed per quest, so progress survives reloads and document refreshes.
- A quest moves to **Completed** when every non-optional objective is ticked (or `Status: Completed`).
- The connected file handle is remembered via the File System Access API (Chrome/Edge over http); **Refresh** re-reads the document after you edit it in Word. Browsers without that API fall back to a normal file picker and drag-and-drop.
- `.docx` is unzipped in-browser using `DecompressionStream('deflate-raw')`; legacy `.doc` is not supported.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Journal theme |
| `docx.js` | ZIP + WordprocessingML reader, Markdown/text reader |
| `app.js` | Note → quest model, rendering, state, file connection |
| `tools\serve.ps1` | Dependency-free local static server |
| `tools\make-sample-docx.ps1` | Builds `Sample Quest Notes.docx` |
