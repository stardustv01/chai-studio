import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChaiBrandMark, chaiBrandAssetPath } from "../../apps/studio-web/src/chai-brand.js";

const approvedAsset = resolve(
  process.cwd(),
  "design/chai-logo-production-v2-faithful/locked/approved-logo-animation-v1/masters/chai-app-icon.svg",
);
const productionAsset = resolve(process.cwd(), "apps/studio-web/public/brand/chai/v1/chai-app-icon.svg");
const appSource = resolve(process.cwd(), "apps/studio-web/src/App.tsx");
const appHtml = resolve(process.cwd(), "apps/studio-web/index.html");

const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

describe("Chai production brand mark", () => {
  it("ships the locked approved app icon byte-for-byte", () => {
    const approved = readFileSync(approvedAsset);
    const production = readFileSync(productionAsset);

    expect(sha256(production)).toBe("55c7cdded269b3acb17ef8ec2a861e78707aa2196c7c6c44f8b308e622d10747");
    expect(production.equals(approved)).toBe(true);
  });

  it("keeps the vector self-contained, labelled, and palette-faithful", () => {
    const svg = readFileSync(productionAsset, "utf8");

    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('<title id="title">Chai Studio app icon</title>');
    expect(svg).toContain("#070A12");
    expect(svg).toContain("#F5EFE2");
    expect(svg).toContain("#F2B33F");
    expect(svg).toContain("#19D9EA");
    expect(svg).not.toMatch(/<(?:script|image|text)\b|font-family|xlink:href|href=/u);
  });

  it("renders as a decorative, non-draggable approved production image", () => {
    const markup = renderToStaticMarkup(createElement(ChaiBrandMark));

    expect(chaiBrandAssetPath).toBe("/brand/chai/v1/chai-app-icon.svg");
    expect(markup).toContain('src="/brand/chai/v1/chai-app-icon.svg"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-chai-brand="approved-v1"');
    expect(markup).toContain('draggable="false"');
  });

  it("replaces every application-shell brand placeholder and provides the browser icon", () => {
    const source = readFileSync(appSource, "utf8");
    const html = readFileSync(appHtml, "utf8");

    expect(source.match(/<ChaiBrandMark \/>/gu)).toHaveLength(3);
    expect(source).not.toMatch(
      /className="(?:brand-icon|launch-required__brand|first-run-welcome__mark)"[^>]*>\s*C\s*</u,
    );
    expect(html).toContain(
      '<link rel="icon" href="/brand/chai/v1/chai-app-icon.svg" type="image/svg+xml" />',
    );
  });
});
