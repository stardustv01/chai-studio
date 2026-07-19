# Chai Studio media contract

`@chai-studio/media` owns secure asset registration, source inspection, proxies, generated views, project fonts, rebuildable asset discovery, reversible asset workflows, review metadata, and delivery rights preflight.

## Authority and identity

- `assets.json` remains the authoritative P04 asset registry. Asset IDs are stable and content identity is SHA-256; cache entries, probe results, proxies, thumbnails, filmstrips, contact sheets, and waveforms are derived.
- Project font, asset-curation, and detailed-rights manifests are versioned project dependencies. Their serialized bytes are hash-addressed by `data` asset records rather than extending the frozen `assets.json` schema.
- Deleting any cache can reduce performance but cannot remove creative state, review decisions, rights evidence references, or registered source identity.

## Path and source safety

- Every source path is canonicalized through the project root or an explicitly approved external-root alias. Traversal, missing files, non-files, prefix tricks, and symlink escapes are rejected.
- Relink accepts only the existing content hash at a new authorized path. Replace accepts new bytes while preserving the logical asset ID. Both produce explicit inverse mutations and source-hash invalidations.
- Finder reveal is represented as an authorized macOS `/usr/bin/open -R` plan; callers execute it outside this pure package.

## Timing, proxies, and views

- ffprobe data retains exact rational rates, time bases, durations, stream metadata, alpha, and VFR status and is cached by original content hash.
- CFR proxies have profile fingerprints, explicit source-to-proxy frame maps, atomic publication, cancellation, and current-source checks. Preview sources are visibly labeled. Final delivery refuses every proxy resolution.
- Generated views share content-addressed, verified, atomic, cancelable caching. Missing or corrupt cache outputs are regenerated from originals.

## Fonts, search, review, and rights

- Local OTF/TTF identity is read from the actual OpenType name table. Rendering consumers resolve and hash the same project manifest; missing or drifted fonts fail explicitly.
- The asset index is rebuildable from `assets.json`, media inspections, usage counts, and registration dates. Compound filtering and stable pagination never become project authority.
- Duplicate hashes remain separate logical identities. The review queue combines duplicate groups with approved, rejected, favorite, and pending curation records.
- Delivery rights preflight evaluates the exact selected assets against reviewed source, creator, license, restrictions, attribution, proof, expiry, territory, prohibited-use, and warning/block policy.

Run `corepack pnpm p06:fixtures` for fixture-contract validation and `corepack pnpm p06:gate` for the formal P06 milestone gate.
