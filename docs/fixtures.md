# Deterministic fixture and golden policy

Fixture inputs live in `fixtures/deterministic`. Reviewed outputs and `checksum-manifest.json` live in `fixtures/goldens`.

- `pnpm fixture:render` renders in memory and fails if the reviewed output differs.
- `pnpm fixture:verify` verifies every manifest checksum.
- `pnpm fixture:update` is the only update path. Its diff must be visually inspected and called out in review.
- CI runs both checks and rejects a silently rewritten golden or manifest.

Future engine fixtures must also record exact tool versions, rational rate, authoritative frame anchors, fonts/assets, strict environment identity, and output hashes or measured perceptual policy.
