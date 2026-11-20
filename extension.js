const vscode = require('vscode');

const EXPO_FILE = '.code-expo.json';
// Font scale per animation frame: grows past the final size, then settles (the "bubble" pop).
const POP_FRAMES = [1.05, 1.15, 1.3, 1.4, 1.35, 1.3];
const FRAME_MS = 35;
const DIM_OPACITY = '0.4';
// Lines left above the step, so it stays clear of the top edge of the projector.
const TOP_MARGIN_LINES = 1;
// Rows VS Code keeps above a revealed line: max(5, editor.cursorSurroundingLines), which is pinned to 0 while presenting.
const REVEAL_PADDING = 5;
// Applied while presenting: no extra highlights over the code, and wrapped lines instead of a horizontal scrollbar.
const PRESENT_SETTINGS = {
  'editor.occurrencesHighlight': 'off',
  'editor.selectionHighlight': false,
  'editor.matchBrackets': 'never',
  'editor.renderLineHighlight': 'none',
  'editor.lightbulb.enabled': 'off',
  'editor.codeLens': false,
  'editor.wordWrap': 'on',
  'editor.scrollbar.horizontal': 'hidden',
  // Off on purpose: a relative scroll issued during a smooth animation cancels it and lands in the wrong place.
  'editor.smoothScrolling': false,
  'editor.scrollBeyondLastLine': true,
  'editor.cursorSurroundingLines': 0,
};
const SAVED_KEYS = [...Object.keys(PRESENT_SETTINGS), 'editor.fontSize'];
// Originals of the settings above, kept in a file while presenting. Older versions kept them in extension state.
const SAVED_FILE = 'saved-settings.json';
const OLD_SAVED_KEY = 'codeExpo.savedSettings';
const SIZE_KEY = 'codeExpo.fontSize';
const DEFAULT_SIZE = 'Default (your editor size)';
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48];

let pop, dim, panel, timer, state, storageUri, savedUri;
let steps = [];
let index = 0;

function folder() {
  // ponytail: first workspace folder only, pick per-file folder if multi-root matters
  const f = vscode.workspace.workspaceFolders?.[0];
  if (!f) throw new Error('Code Expo: open a folder first.');
  return f.uri;
}

async function load() {
  let raw;
  try {
    raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder(), EXPO_FILE));
  } catch {
    return [];
  }
  // A broken JSON file throws here instead of being silently overwritten.
  return JSON.parse(new TextDecoder().decode(raw));
}

async function save(list) {
  const data = new TextEncoder().encode(JSON.stringify(list, null, 2) + '\n');
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder(), EXPO_FILE), data);
}

async function addStep() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.selection.isEmpty) return vscode.window.showWarningMessage('Code Expo: select some code first.');
  const text = await vscode.window.showInputBox({ prompt: 'Explanation for the selected code' });
  if (!text) return;
  const s = ed.selection;
  const list = await load();
  list.push({
    file: vscode.workspace.asRelativePath(ed.document.uri, false),
    start: [s.start.line, s.start.character],
    end: [s.end.line, s.end.character],
    text,
  });
  await save(list);
  vscode.window.showInformationMessage(`Code Expo: step ${list.length} added.`);
}

// A file, not extension state: state is only written to disk now and then, so a crash could lose the
// originals while settings.json already holds the presentation values.
async function readSaved() {
  try {
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(savedUri)));
  } catch {
    return undefined;
  }
}

async function writeSaved(saved) {
  await vscode.workspace.fs.createDirectory(storageUri);
  await vscode.workspace.fs.writeFile(savedUri, new TextEncoder().encode(JSON.stringify(saved)));
}

async function clearSaved() {
  await vscode.workspace.fs.delete(savedUri).then(undefined, () => {});
}

// ponytail: there is no per-session settings API, so this edits user settings and restores them on stop
async function quietEditor() {
  const config = vscode.workspace.getConfiguration();
  // Saved before changing anything, and only once, so a crash or a second start never loses the originals.
  if (!(await readSaved())) {
    const saved = {};
    for (const key of SAVED_KEYS) saved[key] = config.inspect(key)?.globalValue ?? null;
    await writeSaved(saved);
  }
  const size = state.get(SIZE_KEY);
  const settings = size ? { ...PRESENT_SETTINGS, 'editor.fontSize': size } : PRESENT_SETTINGS;
  for (const [key, value] of Object.entries(settings)) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
}

// The choice is remembered for later presentations; it applies right away if one is running.
async function changeFontSize() {
  const current = vscode.workspace.getConfiguration('editor').get('fontSize');
  const items = [DEFAULT_SIZE, ...SIZES.map((s) => ({ label: String(s), description: s === current ? 'current' : '' }))];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Font size for the presented code' });
  if (!pick) return;
  const size = pick === DEFAULT_SIZE ? undefined : Number(pick.label);
  await state.update(SIZE_KEY, size);
  if (!panel) return;
  const value = size ?? (await readSaved())?.['editor.fontSize'] ?? undefined;
  await vscode.workspace.getConfiguration().update('editor.fontSize', value, vscode.ConfigurationTarget.Global);
}

async function restoreEditor() {
  const saved = await readSaved();
  if (!saved) return;
  const config = vscode.workspace.getConfiguration();
  for (const [key, value] of Object.entries(saved)) {
    await config.update(key, value ?? undefined, vscode.ConfigurationTarget.Global);
  }
  await clearSaved();
}

// Puts every setting Code Expo manages back to VS Code's defaults, for when the saved originals are wrong.
async function resetSettings() {
  const answer = await vscode.window.showWarningMessage(
    'Remove the editor settings Code Expo manages (font size, word wrap, highlights, scrolling) from your user settings, so VS Code defaults apply?',
    { modal: true },
    'Reset',
  );
  if (answer !== 'Reset') return;
  if (panel) await stop();
  const config = vscode.workspace.getConfiguration();
  for (const key of SAVED_KEYS) await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  await clearSaved();
  vscode.window.showInformationMessage('Code Expo: editor settings reset to VS Code defaults.');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearDecorations() {
  clearInterval(timer);
  for (const e of vscode.window.visibleTextEditors) {
    for (const d of [...pop, dim]) e.setDecorations(d, []);
  }
}

// ponytail: decorations can't use CSS @keyframes, so the pop swaps one decoration per frame
function animate(ed, range) {
  let frame = 0;
  ed.setDecorations(pop[0], [range]);
  timer = setInterval(() => {
    ed.setDecorations(pop[frame], []);
    frame++;
    ed.setDecorations(pop[frame], [range]);
    if (frame === pop.length - 1) clearInterval(timer);
  }, FRAME_MS);
}

async function show() {
  const step = steps[index];
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder(), step.file));
  const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  // ponytail: ranges are stored as line/char, they drift if the code is edited after recording
  const range = new vscode.Range(...step.start, ...step.end);
  const docEnd = doc.lineAt(doc.lineCount - 1).range.end;

  clearDecorations();
  ed.setDecorations(dim, [new vscode.Range(0, 0, range.start.line, range.start.character), new vscode.Range(range.end, docEnd)]);
  // revealRange always leaves REVEAL_PADDING rows above its target, so scroll those away afterwards.
  // ponytail: a long wrapped line above the step takes several rows, pushing the step lower than TOP_MARGIN_LINES
  const topLine = Math.max(range.start.line - TOP_MARGIN_LINES, 0);
  ed.revealRange(new vscode.Range(topLine, 0, topLine, 0), vscode.TextEditorRevealType.AtTop);
  const padding = Math.min(topLine, REVEAL_PADDING);
  if (padding) await vscode.commands.executeCommand('editorScroll', { to: 'down', by: 'wrappedLine', value: padding });
  // Set after scrolling, so the cursor is already on screen and doesn't trigger a scroll of its own.
  ed.selection = new vscode.Selection(range.start, range.start);
  animate(ed, range);

  // Rendered by VS Code's built-in Markdown extension, the same renderer as the Markdown preview.
  // Single newlines become line breaks, so explanations written before Markdown support keep their layout.
  // ponytail: relative image paths don't load in the webview; add localResourceRoots + asWebviewUri if needed
  const body = await vscode.commands.executeCommand('markdown.api.render', step.text.replace(/\n/g, '  \n'));
  panel.title = `Code Expo ${index + 1}/${steps.length}`;
  panel.webview.html = `<!DOCTYPE html><html><head><style>
body { font-size: 1.6em; line-height: 1.5; padding: 1em; }
code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: .1em .3em; border-radius: 4px; }
pre { background: var(--vscode-textCodeBlock-background); padding: .6em .8em; border-radius: 6px; overflow-x: auto; }
pre code { padding: 0; background: none; }
a { color: var(--vscode-textLink-foreground); }
blockquote { margin: 0; padding-left: 1em; border-left: 4px solid var(--vscode-textBlockQuote-border); opacity: .85; }
table { border-collapse: collapse; } th, td { border: 1px solid var(--vscode-panel-border); padding: .2em .6em; }
img { max-width: 100%; }
</style></head><body>
<div style="opacity:.6;font-size:.6em">${index + 1} / ${steps.length} · ${escapeHtml(step.file)}</div>
${body}</body></html>`;
}

async function start() {
  steps = await load();
  if (!steps.length) return vscode.window.showWarningMessage(`Code Expo: no steps yet. Select code and run "Add Step".`);
  index = 0;
  if (!panel) {
    // The code goes in first: with no editor open, the panel would take column One and the code would open on top of it.
    await vscode.window.showTextDocument(vscode.Uri.joinPath(folder(), steps[0].file), { viewColumn: vscode.ViewColumn.One });
    panel = vscode.window.createWebviewPanel('codeExpo', 'Code Expo', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    panel.onDidDispose(() => { panel = undefined; stop(); });
  }
  vscode.commands.executeCommand('setContext', 'codeExpo.active', true);
  await quietEditor();
  await show();
}

async function stop() {
  vscode.commands.executeCommand('setContext', 'codeExpo.active', false);
  clearDecorations();
  panel?.dispose();
  await restoreEditor();
}

// Steps render one at a time; overlapping scrolls from fast key presses would measure each other's half-done positions.
let showing = Promise.resolve();

function move(delta) {
  const next = index + delta;
  if (!panel || next < 0 || next >= steps.length) return;
  index = next;
  showing = showing.then(show, show);
  return showing;
}

function activate(context) {
  state = context.globalState;
  storageUri = context.globalStorageUri;
  savedUri = vscode.Uri.joinPath(storageUri, SAVED_FILE);
  // Runs at startup and puts settings back if VS Code closed mid-presentation. Commands wait for it, otherwise
  // a start racing this restore keeps the old snapshot while it gets deleted, and stop has nothing to restore.
  const restored = (async () => {
    const old = state.get(OLD_SAVED_KEY);
    if (old && !(await readSaved())) await writeSaved(old);
    await state.update(OLD_SAVED_KEY, undefined);
    await restoreEditor();
  })().catch(() => {});
  // ponytail: font-size has no decoration option, so it rides in via the textDecoration CSS value
  pop = POP_FRAMES.map((scale) => vscode.window.createTextEditorDecorationType({ textDecoration: `none; font-size: ${scale}em` }));
  dim = vscode.window.createTextEditorDecorationType({ opacity: DIM_OPACITY });

  const run = (fn) => async (...args) => {
    try { await restored; await fn(...args); } catch (e) { vscode.window.showErrorMessage(e.message); }
  };
  context.subscriptions.push(
    ...pop,
    dim,
    vscode.commands.registerCommand('codeExpo.addStep', run(addStep)),
    vscode.commands.registerCommand('codeExpo.start', run(start)),
    vscode.commands.registerCommand('codeExpo.next', run(() => move(1))),
    vscode.commands.registerCommand('codeExpo.prev', run(() => move(-1))),
    vscode.commands.registerCommand('codeExpo.stop', run(stop)),
    vscode.commands.registerCommand('codeExpo.changeFontSize', run(changeFontSize)),
    vscode.commands.registerCommand('codeExpo.resetSettings', run(resetSettings)),
  );
}

module.exports = { activate, deactivate: stop };
