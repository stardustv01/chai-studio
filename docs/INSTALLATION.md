# Install, doctor, launch, and uninstall

Use the supported arm64 Mac with Node 22.17.0, Corepack/pnpm 11.11.0, FFmpeg/FFprobe 7.1.1, and the pinned Playwright-managed Chromium downloads. Unpack the immutable release source into an application-only folder; keep `.chai` projects elsewhere.

```sh
corepack pnpm install --frozen-lockfile
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build apps/studio-web --config apps/studio-web/vite.config.ts
node scripts/chai-studio.mjs doctor
node scripts/chai-studio.mjs install --prefix "$HOME/Applications/Chai Studio Local"
"$HOME/Applications/Chai Studio Local/bin/chai-studio" launch
```

Doctor prints OS, CPU, memory, Node, FFmpeg/FFprobe, isolated browser identities, required build files, support status, and the environment fingerprint. Launch is blocked when required checks fail. It opens no browser automatically; paste the printed loopback URL into the browser you choose for personal operation.

On the first default launch, Chai Studio creates `~/Movies/Chai Studio/Chai Studio Intro.chai`. The project contains three locally generated, owned, validated PNG scenes on a 450-frame editable timeline. It is a real renderable starter, not a placeholder receipt or unsupported media mock. Use `--project PATH` to choose another `.chai` folder, or `--starter empty --title "My Film"` to create an empty project instead.

The launcher injects a new session token before React starts. Opening the web URL without that bootstrap shows only a fail-closed “Launch Chai Studio from the CLI” screen; it never exposes the development UI fixture or project actions. The token is not placed in the URL or printed to the terminal.

Uninstall with `chai-studio uninstall --prefix "$HOME/Applications/Chai Studio Local"`. It accepts only an exact Chai installation marker, refuses a prefix containing a `.chai` project, and reports `projectsDeleted: false`. Projects, backups, archives, and approved outputs outside the application prefix are never removed.
