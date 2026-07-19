import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChaiIcon, chaiIconNames, isChaiIconSizeApproved } from "../../apps/studio-web/src/chai-icon.js";

interface ProductionIconManifest {
  readonly total: number;
  readonly variants: Readonly<
    Record<"dark" | "light", readonly Readonly<{ name: string; file: string; sha256: string }>[]>
  >;
}

const iconRoot = resolve(process.cwd(), "apps/studio-web/public/icons/chai");
const manifest = JSON.parse(
  readFileSync(resolve(iconRoot, "manifest.json"), "utf8"),
) as ProductionIconManifest;

describe("Chai production icon system", () => {
  it("keeps the typed runtime catalog synchronized with both production variants", () => {
    expect(chaiIconNames).toHaveLength(123);
    expect(new Set(chaiIconNames)).toHaveLength(123);
    expect(manifest.total).toBe(123);

    for (const variant of ["dark", "light"] as const) {
      expect(manifest.variants[variant].map((entry) => entry.name)).toEqual([...chaiIconNames]);
      expect(new Set(manifest.variants[variant].map((entry) => entry.sha256)).size).toBe(123);
    }
  });

  it("ships every icon as a 96px RGBA PNG with a nonempty file", () => {
    for (const variant of ["dark", "light"] as const) {
      for (const entry of manifest.variants[variant]) {
        const png = readFileSync(resolve(iconRoot, entry.file));
        expect(png.byteLength, `${variant}/${entry.name}`).toBeGreaterThan(100);
        expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(png.readUInt32BE(16), `${variant}/${entry.name} width`).toBe(96);
        expect(png.readUInt32BE(20), `${variant}/${entry.name} height`).toBe(96);
        expect(png.readUInt8(25), `${variant}/${entry.name} color type`).toBe(6);
      }
    }
  });

  it("renders decorative images and enforces the approved 14px subset", () => {
    const approved = renderToStaticMarkup(createElement(ChaiIcon, { name: "play", size: 14 }));
    const clamped = renderToStaticMarkup(createElement(ChaiIcon, { name: "render-timeline", size: 14 }));

    expect(approved).toContain('alt=""');
    expect(approved).toContain('aria-hidden="true"');
    expect(approved).toContain('data-icon-policy="micro-approved"');
    expect(clamped).toContain('data-icon-policy="micro-unsupported"');
    expect(isChaiIconSizeApproved("play", 14)).toBe(true);
    expect(isChaiIconSizeApproved("render-timeline", 14)).toBe(false);
    expect(isChaiIconSizeApproved("render-timeline", 16)).toBe(true);
  });
});
