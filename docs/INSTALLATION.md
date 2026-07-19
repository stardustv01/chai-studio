# Install, doctor, launch, and uninstall

Use the supported arm64 Mac with Node 22.17.0, FFmpeg/FFprobe 7.1.1, and the pinned Playwright-managed Chromium downloads. Keep `.chai` projects outside the application prefix.

Verify and unpack the supplied personal-local RC archive. End users do not install pnpm, compile TypeScript, or run Vite:

```sh
shasum -a 256 -c chai-studio-1.0.0-rc.3-darwin-arm64.tar.gz.sha256
tar -xzf chai-studio-1.0.0-rc.3-darwin-arm64.tar.gz
./chai-studio-1.0.0-rc.3-darwin-arm64/bin/chai-studio doctor
./chai-studio-1.0.0-rc.3-darwin-arm64/bin/chai-studio install --prefix "$HOME/Applications/Chai Studio Local"
"$HOME/Applications/Chai Studio Local/bin/chai-studio" launch
```

Installation verifies every bundled file and internal symlink, copies the complete runtime under the installation prefix, verifies the copied identity again, and creates a launcher pointing only to those installed bytes. The extracted archive may then be moved or deleted.

Doctor prints OS, CPU, memory, Node, FFmpeg/FFprobe, isolated browser identities, required runtime files, support status, and the environment fingerprint. Launch is blocked when required checks fail. It opens no browser automatically; paste the printed loopback URL into the browser you choose for personal operation.

On the first default launch, Chai Studio creates `~/Movies/Chai Studio/Chai Studio Intro.chai`. The project contains three locally generated, owned, validated PNG scenes on a 450-frame editable timeline. It is a real renderable starter, not a placeholder receipt or unsupported media mock. Use `--project PATH` to choose another `.chai` folder, or `--starter empty --title "My Film"` to create an empty project instead.

The installed runtime serves the compiled web application directly; Vite and the source checkout are not used. The launcher injects a new session token before React starts. Opening the web URL without that bootstrap shows only a fail-closed “Launch Chai Studio from the CLI” screen; it never exposes the development UI fixture or project actions. The token is not placed in the URL or printed to the terminal.

Uninstall with `chai-studio uninstall --prefix "$HOME/Applications/Chai Studio Local"`. It accepts only an exact Chai installation marker, refuses a prefix containing a `.chai` project, and reports `projectsDeleted: false`. Projects, backups, archives, and approved outputs outside the application prefix are never removed.
