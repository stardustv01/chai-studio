# Install, doctor, launch, and uninstall

Use the supported arm64 Mac with Node 22.17.0, FFmpeg/FFprobe 7.1.1, and the pinned Playwright-managed Chromium downloads. Keep `.chai` projects outside the application prefix.

After registry publication, the normal install and launch path is:

```sh
npx @chai-studio/cli@latest install --launch
npx @chai-studio/cli@latest doctor
npx @chai-studio/cli@latest launch
```

The registry package contains the compiled Chai-owned application, declares its Node-side runtime
libraries as exact npm dependencies, and does not require pnpm. `install` downloads the isolated
Playwright Chromium and runs the runtime doctor; FFmpeg/FFprobe must already be available on `PATH`.
A global command is optional: `npm install --global @chai-studio/cli` makes the same operations
available as `chai-studio install`, `chai-studio doctor`, and `chai-studio launch`.

For an offline personal-local RC, verify and unpack the supplied archive instead. End users still do not install pnpm, compile TypeScript, or run Vite:

```sh
shasum -a 256 -c chai-studio-1.0.0-rc.4-darwin-arm64.tar.gz.sha256
tar -xzf chai-studio-1.0.0-rc.4-darwin-arm64.tar.gz
./chai-studio-1.0.0-rc.4-darwin-arm64/bin/chai-studio doctor
./chai-studio-1.0.0-rc.4-darwin-arm64/bin/chai-studio install --prefix "$HOME/Applications/Chai Studio Local"
"$HOME/Applications/Chai Studio Local/bin/chai-studio" launch
```

Installation verifies every bundled file and internal symlink, copies the complete runtime under the installation prefix, verifies the copied identity again, and creates a launcher pointing only to those installed bytes. The extracted archive may then be moved or deleted.

Doctor prints OS, CPU, memory, Node, FFmpeg/FFprobe, isolated browser identities, required runtime files, support status, and the environment fingerprint. Launch is blocked when required checks fail. It opens no browser automatically; paste the printed loopback URL into the browser you choose for personal operation.

On the first default launch, Chai Studio creates `~/Movies/Chai Studio/Chai Studio Intro.chai`. The project contains three locally generated, owned, validated PNG scenes on a 450-frame editable timeline. It is a real renderable starter, not a placeholder receipt or unsupported media mock. Use `--project PATH` to choose another `.chai` folder, or `--starter empty --title "My Film"` to create an empty project instead.

The installed runtime serves the compiled web application directly; Vite and the source checkout are not used. The launcher injects a new session token before React starts. Opening the web URL without that bootstrap shows only a fail-closed “Launch Chai Studio from the CLI” screen; it never exposes the development UI fixture or project actions. The token is not placed in the URL or printed to the terminal.

An `npx` invocation is ephemeral and has no application prefix to uninstall. Remove a global registry
installation with `npm uninstall --global @chai-studio/cli`. The exact offline personal launcher
still supports `uninstall --prefix "$HOME/Applications/Chai Studio Local"`; it accepts only an exact
Chai installation marker, refuses a prefix containing a `.chai` project, and reports
`projectsDeleted: false`. Projects, backups, archives, and approved outputs outside the application
prefix are never removed.
