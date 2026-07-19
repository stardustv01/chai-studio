# ADR 0010 — Version 1 remains localhost without a desktop wrapper

**Status:** Accept for Version 1  
**Date:** 2026-07-16

Version 1 is a loopback-only Node Studio server plus local web UI. It requires no cloud account and introduces no Electron, Tauri, native wrapper, updater, keychain, or wrapper-specific filesystem authority.

The local CLI owns doctor, launch, install marker, uninstall preservation, backup/restore, and environment identity. Browser isolation remains explicit, and launch never selects or opens installed Google Chrome automatically.

A future wrapper requires a post-stability ADR covering threat model, signing/notarization, update/rollback, sandbox entitlements, project access, browser/runtime ownership, migration, tests, licenses, distribution, and support. Foundation packages remain wrapper-independent.
