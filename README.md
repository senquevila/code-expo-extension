# Code Expo

Present code step by step in VS Code: each step highlights a region of code and shows its explanation in a side panel.

![Code Expo presenting a Python file step by step](images/demo.gif)

## Usage

### Record steps

1. Select some code.
2. Right-click and choose **Add Step from Selection**, then type the explanation.
3. Repeat. Steps can be in any file in the workspace.

Steps are saved in order to `.code-expo.json` at the workspace root. Edit that file to reorder steps or write longer text (use `\n` for line breaks).

Explanations support Markdown: headings, **bold**, *italic*, `inline code`, lists, links, quotes, tables and code blocks. Each line break is kept as written.

### Present

Run **Code Expo: Start Presentation** from the Command Palette.

| Key | Action |
|-----|--------|
| Enter, →, PageDown | Next step |
| ←, PageUp | Previous step |
| Esc | Stop |

Presentation clickers send PageUp/PageDown, so they work too.

While presenting, long lines wrap instead of showing a horizontal scrollbar. To change the font size of the code, click the **Aa** button in the editor title bar. The size is remembered for later presentations. The stop button next to it ends the presentation.

Presenting temporarily changes some editor settings (font size, word wrap, highlights, scrolling). Your own values come back when you stop, or the next time VS Code starts if it was closed mid-presentation. If they ever get stuck, run **Code Expo: Reset Editor Settings** to put those settings back to VS Code's defaults.

## Release notes

### 0.0.2

- Stopping a presentation now restores your original font size and the other editor settings, even after changing the size with **Aa** during the presentation.
- If VS Code is closed mid-presentation, your settings come back the next time it starts.
- New stop button in the editor title bar, next to **Aa**.
- New command **Code Expo: Reset Editor Settings**, to clear settings left behind by 0.0.1.
- Explanations support Markdown.

**Upgrading from 0.0.1:** run **Code Expo: Reset Editor Settings** once. 0.0.1 could keep presentation values (such as a large font size) as your normal settings. The reset puts them back to VS Code's defaults, so set your preferred font size again afterwards if you had one.

### 0.0.1

- First release: record steps from selections, present them with Enter, arrow keys or a clicker, enlarged and animated highlight with faded surrounding code, font size picker.

## Limitations

- Steps store line and column numbers, so editing the code after recording shifts the highlights.
- Only the first folder of a multi-folder workspace is used.
- The enlarged code keeps the editor's normal line height, so tall multi-line steps can overlap slightly. Lower the last value in `POP_FRAMES` (top of `extension.js`) if it bothers you.
