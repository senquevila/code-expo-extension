# Local installation

Pick one of the options below.

## Option 1: Symlink into your extensions folder (no tools needed)

```bash
ln -sfn "$(pwd)" ~/.vscode/extensions/local.code-expo-0.0.1
```

Run it from this folder, then restart VS Code. Changes to `extension.js` take effect after **Developer: Reload Window**.

To uninstall, remove the link:

```bash
rm ~/.vscode/extensions/local.code-expo-0.0.1
```

If you uninstalled it from the VS Code Extensions view instead, VS Code keeps ignoring the link even after you create it again. Quit VS Code, run this, and reopen it:

```bash
node -e 'const f=require("os").homedir()+"/.vscode/extensions/.obsolete",o=JSON.parse(require("fs").readFileSync(f));delete o["local.code-expo-0.0.1"];require("fs").writeFileSync(f,JSON.stringify(o))'
```

## Option 2: Install from a `.vsix` package

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
```

```bash
code --install-extension code-expo-0.0.1.vsix
```

To uninstall:

```bash
code --uninstall-extension local.code-expo
```

## Option 3: Run without installing (development)

Open this folder in VS Code and press **F5**. A second VS Code window opens with the extension loaded.
