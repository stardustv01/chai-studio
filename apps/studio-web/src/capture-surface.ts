export const captureStudioProgramFrame = async (
  includeOverlays: boolean,
  target: "program" | "source" = "program",
): Promise<string> => {
  const source = document.querySelector<HTMLElement>(
    target === "source" ? "[data-source-capture-surface]" : "[data-program-capture-surface]",
  );
  if (source === null) throw new Error(`No visible ${target} capture surface is available.`);
  const bounds = source.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) throw new Error(`The ${target} capture surface has no size.`);
  const clone = source.cloneNode(true) as HTMLElement;
  inlineComputedStyles(source, clone);
  clone.style.width = `${String(bounds.width)}px`;
  clone.style.height = `${String(bounds.height)}px`;
  clone.style.transform = "none";
  if (!includeOverlays) {
    clone
      .querySelectorAll(
        ".monitor-overlay-canvas,.monitor-frame-identities,.comparison-split-control,.art-safe-area,.art-grid",
      )
      .forEach((node) => {
        node.remove();
      });
  }
  replaceCanvasCopies(source, clone, includeOverlays);
  const markup = new XMLSerializer().serializeToString(clone);
  const svgNamespace = ["http:", "", "www.w3.org", "2000", "svg"].join("/");
  const svg = `<svg xmlns="${svgNamespace}" width="${String(bounds.width)}" height="${String(bounds.height)}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.width * ratio));
  canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The browser cannot create a capture canvas.");
  context.scale(ratio, ratio);
  context.drawImage(image, 0, 0, bounds.width, bounds.height);
  return canvas.toDataURL("image/png");
};

const inlineComputedStyles = (source: Element, clone: Element): void => {
  if (source instanceof HTMLElement && clone instanceof HTMLElement) {
    const computed = getComputedStyle(source);
    clone.style.cssText = [...computed]
      .map((property) => `${property}:${computed.getPropertyValue(property)};`)
      .join("");
  }
  const sourceChildren = [...source.children];
  const cloneChildren = [...clone.children];
  sourceChildren.forEach((child, index) => {
    const copy = cloneChildren[index];
    if (copy !== undefined) inlineComputedStyles(child, copy);
  });
};

const replaceCanvasCopies = (source: Element, clone: Element, includeOverlays: boolean): void => {
  if (!includeOverlays) return;
  const sourceCanvases = [...source.querySelectorAll("canvas")];
  const cloneCanvases = [...clone.querySelectorAll("canvas")];
  sourceCanvases.forEach((canvas, index) => {
    const copy = cloneCanvases[index];
    if (copy === undefined) return;
    const image = document.createElement("img");
    image.src = canvas.toDataURL("image/png");
    image.style.cssText = (copy as HTMLElement).style.cssText;
    copy.replaceWith(image);
  });
};

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("The browser could not rasterize the program frame."));
    };
    image.src = source;
  });
