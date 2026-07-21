import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("authenticated Studio resolves the recorded editor, capture, persistence, and render feedback", async ({
  page,
}) => {
  await page.goto("/?workspace=edit");
  await expect(page.getByTestId("server-status")).toContainText("Local");
  await expect(page.locator('.brand-icon img[data-chai-brand="approved-v1"]')).toBeVisible();
  await expect(page.locator(".truth-status")).not.toContainText("Contract mock");
  await expectRevisionIdentityAligned(page);
  expect(
    await page.evaluate(() => ({
      token: Boolean(window.__CHAI_STUDIO_SESSION__?.token),
      tokenInUrl: window.location.href.includes(window.__CHAI_STUDIO_SESSION__?.token ?? "missing"),
    })),
  ).toEqual({ token: true, tokenInUrl: false });

  await page.locator(".project-identity").click();
  await page.getByRole("button", { name: "Switch project" }).click();
  const projectLauncher = page.getByRole("dialog", { name: "Open or create a Chai Studio project" });
  await expect(projectLauncher).toBeVisible();
  await expect(projectLauncher.getByLabel("Recent projects")).toContainText("Launch Film");
  await projectLauncher
    .getByLabel("Recent projects")
    .getByRole("button", { name: /Launch Film/ })
    .click();
  await expect(projectLauncher).toHaveCount(0);
  await expect(page.getByTestId("server-status")).toContainText("Local");
  await expectRevisionIdentityAligned(page);

  const leftPanel = page.locator(".left-panel");
  await leftPanel.getByLabel("Import rights").selectOption("owned");
  await leftPanel.getByLabel("Choose project media").setInputFiles([
    {
      name: "owner-review.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP4w8AARAwQCgAfjgPxzzTeXgAAAABJRU5ErkJggg==",
        "base64",
      ),
    },
    {
      name: "raw-video.mp4",
      mimeType: "video/mp4",
      buffer: await readFile(path.resolve("spikes/milestone-0/fixtures/canonical/assets/raw-video.mp4")),
    },
    {
      name: "owner-tone.wav",
      mimeType: "audio/wav",
      buffer: toneWave(48_000, 96_000, 440, 0.25),
    },
  ]);
  await expect(page.getByText("3 assets imported", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await page.locator(".media-center").getByLabel("Search footage").fill("raw-video");
  const uploadedVideo = page.locator(".media-center").getByRole("button", { name: /raw-video\.mp4/ });
  await uploadedVideo.click();
  const sourcePath = page.getByLabel("Project-relative or approved source path");
  const projectRelativeSource = await sourcePath.inputValue();
  await sourcePath.fill(
    path.join(os.tmpdir(), "chai-studio-authenticated-e2e", "Launch Film.chai", projectRelativeSource),
  );
  await page.getByRole("button", { name: "Relink source" }).click();
  await expect(page.getByText("Asset relinked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate proxy", exact: true }).click();
  await expect(page.locator(".media-proxy-progress")).toContainText("completed", { timeout: 20_000 });
  await expect(page.locator(".media-proxy-progress")).toContainText("100%");

  await page.locator(".media-center").getByLabel("Search footage").fill("owner-review");
  const uploadedAsset = page
    .locator(".media-center")
    .getByRole("button", { name: /owner-review\.png/ })
    .first();
  await expect(uploadedAsset).toContainText("valid");
  await uploadedAsset.click();
  await expect(uploadedAsset).toHaveAttribute("aria-pressed", "true");
  const uploadedRecord = await page.evaluate(async () => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) return null;
    const response = await fetch(`${session.serverOrigin}/api/v1/projects/current/snapshot`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const envelope = (await response.json()) as {
      readonly data?: {
        readonly assets?: {
          readonly assets?: readonly Readonly<Record<string, unknown>>[];
        };
      };
    };
    return envelope.data?.assets?.assets?.find(
      (asset) => typeof asset.path === "string" && asset.path.endsWith("owner-review.png"),
    );
  });
  expect(uploadedRecord).toMatchObject({
    kind: "image",
    rights: "owned",
    validationState: "valid",
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const importedAssetRow = leftPanel.getByRole("button", { name: /owner-review\.png/ });
  await expect(importedAssetRow).toHaveAttribute("draggable", "true");
  const timelineEditor = page.getByRole("region", { name: "Frame-exact timeline editor" });
  const revisionBeforeTrack = await page.locator(".project-identity").getAttribute("data-revision-id");
  await timelineEditor.getByRole("button", { name: "Add track" }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeTrack);
  const emptyVideoLane = timelineEditor
    .locator(".timeline-track")
    .filter({ hasText: "video", hasNot: page.locator(".editor-clip") })
    .locator(".timeline-track-lane")
    .first();
  await expect(emptyVideoLane).toBeVisible();
  const revisionBeforePlacement = await page.locator(".project-identity").getAttribute("data-revision-id");
  await importedAssetRow.dragTo(emptyVideoLane, { targetPosition: { x: 1_000, y: 20 } });
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforePlacement);
  await expect.poll(() => importedAssetStartFrame(page, "owner-review.png")).toMatch(/^(?:0|[1-9][0-9]*)$/u);
  const draggedFrame = await importedAssetStartFrame(page, "owner-review.png");
  expect(draggedFrame).toMatch(/^(?:0|[1-9][0-9]*)$/u);
  const revisionBeforeUndoPlacement = await page
    .locator(".project-identity")
    .getAttribute("data-revision-id");
  await timelineEditor.getByRole("button", { name: /Undo Insert clip/ }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeUndoPlacement);
  await expect(timelineEditor.getByRole("button", { name: /owner-review\.png/ })).toHaveCount(0);
  const revisionBeforeUndoTrack = await page.locator(".project-identity").getAttribute("data-revision-id");
  await timelineEditor.getByRole("button", { name: /Undo Add track/ }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeUndoTrack);

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await page
    .locator(".media-center")
    .getByRole("button", { name: /owner-review\.png/ })
    .click();
  const revisionBeforeAppend = await page.locator(".project-identity").getAttribute("data-revision-id");
  await page.getByRole("button", { name: "Append to timeline" }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeAppend);
  const uploadedFrame = await importedAssetStartFrame(page, "owner-review.png");
  if (uploadedFrame === null) throw new Error("The uploaded image was not placed on the timeline.");
  await leftPanel.getByRole("button", { name: /Audio 2/ }).click();
  await page.locator(".media-center").getByLabel("Search footage").fill("owner-tone");
  const uploadedAudio = page.locator(".media-center").getByRole("button", { name: /owner-tone\.wav/ });
  await expect(uploadedAudio).toContainText("valid");
  await uploadedAudio.click();
  const revisionBeforeAudioPlacement = await page
    .locator(".project-identity")
    .getAttribute("data-revision-id");
  await page.getByRole("button", { name: "Append to timeline" }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeAudioPlacement);
  const audioPlacement = await moveImportedAudioToFrame(page, "owner-tone.wav", uploadedFrame);
  expect(audioPlacement).toMatchObject({ startFrame: uploadedFrame, hasAudio: true, kind: "audio" });
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expectRevisionIdentityAligned(page);

  const timeline = page.getByRole("region", { name: "Frame-exact timeline editor" });
  await timeline
    .getByRole("button", { name: /Interview A/ })
    .first()
    .click();

  const monitor = page.getByRole("region", { name: "Program monitor" });
  const frameLabel = monitor.locator(".monitor-time-authority span");
  const initialFrame = await frameNumber(frameLabel);
  await monitor.getByRole("button", { name: "Play program preview" }).click();
  await expect.poll(() => frameNumber(frameLabel)).toBeGreaterThan(initialFrame);
  await monitor.getByRole("button", { name: "Pause program preview" }).click();

  await expect(page.locator(".topbar-truth").getByRole("button", { name: /Capture exact/ })).toBeEnabled();
  await monitor.getByRole("button", { name: "Open capture modes" }).click();
  await expect(
    monitor.getByRole("menuitem", {
      name: "Exact fidelity frame Authoritative shared-media still · overlays excluded",
    }),
  ).toBeEnabled();
  await expect(
    monitor.getByRole("menuitem", {
      name: "Selected clip only Exact final-compositor isolation",
    }),
  ).toBeEnabled();
  await monitor.getByRole("menuitem", { name: "Current preview frame Fast · visibly approximate" }).click();
  await expect(page.getByText("Interactive frame completed", { exact: true })).toBeVisible();
  const captureCount = await page.evaluate(async () => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) return 0;
    const response = await fetch(`${session.serverOrigin}/api/v1/captures`, {
      headers: {
        authorization: `Bearer ${session.token}`,
        "x-chai-csrf-token": session.token,
      },
    });
    const envelope = (await response.json()) as { readonly data?: readonly unknown[] };
    return envelope.data?.length ?? 0;
  });
  expect(captureCount).toBe(1);

  await timeline.getByRole("button", { name: /Interview A/ }).click();
  const inspector = page.getByLabel("Contextual inspector");
  const opacity = inspector.getByLabel("Opacity", { exact: true });
  const blendMode = inspector.getByLabel("Blend Mode", { exact: true });
  await blendMode.selectOption("screen");
  await expect
    .poll(() => authoritativeOpacityEvidence(page).then((evidence) => evidence.blendMode))
    .toBe("screen");
  await opacity.fill("64");
  await opacity.press("Enter");
  await expect(opacity).toHaveValue("64");
  await expect
    .poll(() => authoritativeOpacityEvidence(page).then((evidence) => evidence.clipOpacity))
    .toBe(64);
  await timeline.getByRole("button", { name: /Undo Update clip property/ }).click();
  await expect(opacity).toHaveValue("100");
  await expect
    .poll(() => authoritativeOpacityEvidence(page).then((evidence) => evidence.clipOpacity))
    .toBe(100);
  await timeline.getByRole("button", { name: /Redo Update clip property/ }).click();
  await expect(opacity).toHaveValue("64");
  await expect
    .poll(() => authoritativeOpacityEvidence(page).then((evidence) => evidence.clipOpacity))
    .toBe(64);
  await page.reload();
  await expectRevisionIdentityAligned(page);
  await timeline.getByRole("button", { name: /Interview A/ }).click();
  await expect(page.getByLabel("Contextual inspector").getByLabel("Opacity", { exact: true })).toHaveValue(
    "64",
  );
  await expect(page.getByLabel("Contextual inspector").getByLabel("Blend Mode", { exact: true })).toHaveValue(
    "screen",
  );

  const markedStart = await frameNumber(frameLabel);
  await monitor.getByRole("button", { name: "Mark timeline in" }).click();
  await expect(timeline.getByText(`I/O ${String(markedStart)}–1800`)).toBeVisible();
  await monitor.getByRole("button", { name: "Next frame" }).click();
  await monitor.getByRole("button", { name: "Next frame" }).click();
  await monitor.getByRole("button", { name: "Mark timeline out" }).click();
  await expect(timeline.getByText(`I/O ${String(markedStart)}–${String(markedStart + 3)}`)).toBeVisible();

  await page.getByLabel("Edit workspace").getByRole("tab", { name: "Media", exact: true }).click();
  const productAsset = page.getByRole("button", { name: /product_macro_02\.mov/ }).first();
  await productAsset.click();
  await expect(productAsset).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("product_macro_02.mov", { exact: true }).last()).toBeVisible();

  await page
    .getByRole("navigation", { name: "Studio workspaces" })
    .getByRole("button", { name: "Media", exact: true })
    .click();
  const sourceMonitor = page.getByRole("region", { name: "Professional source monitor" });
  await page.locator(".media-center").getByLabel("Search footage").fill("owner-review");
  await page
    .locator(".media-center")
    .getByRole("button", { name: /owner-review\.png/ })
    .click();
  await sourceMonitor.getByRole("tab", { name: "Image" }).click();
  const decodedSourceFrame = sourceMonitor.getByTestId("source-decoded-frame");
  await expect(decodedSourceFrame).toBeVisible({ timeout: 20_000 });
  expect(
    await decodedSourceFrame.evaluate((image: HTMLImageElement) => ({
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  ).toEqual({ complete: true, width: 960, height: 540 });
  await expect(sourceMonitor).toContainText("sha256");
  await sourceMonitor.getByRole("button", { name: "Capture source frame" }).click();
  await expect(page.getByText("Source frame completed", { exact: true })).toBeVisible();
  await sourceMonitor.getByRole("tab", { name: "Video" }).click();
  await sourceMonitor.getByRole("radio", { name: "Insert" }).click();
  const revisionBeforeSourceEdit = await page.locator(".project-identity").getAttribute("data-revision-id");
  await sourceMonitor.getByRole("button", { name: "Apply three-point edit" }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeSourceEdit);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(timeline.getByRole("button", { name: /Source · video/ })).toBeVisible();
  await timeline.getByRole("button", { name: /Undo Insert clip/ }).click();
  await expect(timeline.getByRole("button", { name: /Source · video/ })).toHaveCount(0);
  await expect(timeline.getByRole("button", { name: /owner-review\.png/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const movableClip = timeline.getByRole("button", { name: /Interview A/ }).first();
  const v2 = timeline.getByLabel("V2 video track lane");
  const clipBounds = await movableClip.boundingBox();
  const v2Bounds = await v2.boundingBox();
  if (clipBounds === null || v2Bounds === null) throw new Error("Timeline drag geometry is unavailable.");
  await page.mouse.move(clipBounds.x + clipBounds.width / 2, clipBounds.y + clipBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(clipBounds.x + clipBounds.width / 2, v2Bounds.y + v2Bounds.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(v2.getByRole("button", { name: /Interview A/ })).toBeVisible();
  await timeline.getByRole("button", { name: /Undo Move clip/ }).click();

  await timeline.getByRole("button", { name: "B Blade" }).click();
  const interview = timeline.getByRole("button", { name: /Interview A/ }).first();
  const interviewBounds = await interview.boundingBox();
  if (interviewBounds === null) throw new Error("Blade geometry is unavailable.");
  await page.mouse.click(
    interviewBounds.x + interviewBounds.width * 0.25,
    interviewBounds.y + interviewBounds.height / 2,
  );
  await expect(timeline.getByRole("button", { name: /Interview A/ })).toHaveCount(2);
  await expect(timeline.getByText(/48–14[34] · 9[56]f/)).toBeVisible();
  await expect(timeline.getByText(/14[34]–430 · 28[67]f/)).toBeVisible();
  await timeline.getByRole("button", { name: /Undo Split clip/ }).click();
  await expect(timeline.getByRole("button", { name: /Interview A/ })).toHaveCount(1);
  await timeline.getByRole("button", { name: "V Select" }).click();

  await timeline
    .getByRole("button", { name: /Interview A/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.getByLabel("Apply requested change to").selectOption("marked-range");
  const manifest = page.locator(".manifest");
  await expect(manifest).toContainText('"scopeKind": "marked-range"');
  await expect(manifest).toContainText('"durationFrames": "3"');

  await page.getByRole("button", { name: "Animation", exact: true }).click();
  const curve = page.getByLabel("Deterministic keyframe curve editor");
  await expect(curve.getByLabel("Animated property")).toHaveValue("transform.opacity");
  const addKey = curve.getByRole("button", { name: "Add key" });
  await expect(addKey).toBeEnabled();
  await curve.getByLabel("Keyframe value").fill("80");
  await addKey.click();
  await expect(curve.getByText("1 keys", { exact: true })).toBeVisible();
  await expect
    .poll(() => authoritativeOpacityEvidence(page).then((evidence) => evidence.opacityKeyValues))
    .toContain(80);
  await curve.getByLabel("Tangent mode").selectOption("continuous");
  await expect(curve.getByRole("status")).toContainText("Continuous tangents applied to 1 key(s).");
  await curve.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(curve.getByRole("status")).toContainText("Copied 1 keyframe.");
  await curve.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(curve.getByRole("status")).toContainText("Pasted 1 keyframe");
  await expect(curve.getByText("2 keys", { exact: true })).toBeVisible();
  await expect(page.getByText("RangeError", { exact: false })).toHaveCount(0);
  await expect(curve.getByLabel("Tangent mode")).toHaveValue("continuous");
  await expect
    .poll(() => authoritativeOpacityEvidence(page).then((evidence) => evidence.opacityKeyValues.length))
    .toBe(2);
  await expectRevisionIdentityAligned(page);

  await monitor.getByLabel("Current frame").fill(uploadedFrame);
  await monitor.getByLabel("Current frame").press("Enter");
  await expect.poll(() => frameNumber(frameLabel)).toBe(Number(uploadedFrame));
  const revisionBeforeAvIn = await page.locator(".project-identity").getAttribute("data-revision-id");
  await monitor.getByRole("button", { name: "Mark timeline in" }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeAvIn);
  await monitor.getByRole("button", { name: "Next frame" }).click();
  await monitor.getByRole("button", { name: "Next frame" }).click();
  await expect.poll(() => frameNumber(frameLabel)).toBe(Number(uploadedFrame) + 2);
  const revisionBeforeAvOut = await page.locator(".project-identity").getAttribute("data-revision-id");
  await monitor.getByRole("button", { name: "Mark timeline out" }).click();
  await expect
    .poll(() => page.locator(".project-identity").getAttribute("data-revision-id"))
    .not.toBe(revisionBeforeAvOut);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(timeline.getByText(`I/O ${uploadedFrame}–${String(Number(uploadedFrame) + 3)}`)).toBeVisible();
  await monitor.getByLabel("Current frame").fill(uploadedFrame);
  await monitor.getByLabel("Current frame").press("Enter");

  await page.getByRole("button", { name: "Deliver", exact: true }).click();
  const queue = page.getByLabel("Authoritative render queue");
  await expect(queue).not.toContainText("Sample projection");
  const receipt = page.getByLabel("QA and render receipt");
  await expect(receipt).toContainText("No preflight recorded.");
  await expect(receipt).not.toContainText("Sample checks passed");
  await expect(page.locator(".global-timecode")).not.toHaveText("00:00:00;00");
  await page.getByLabel("Delivery profiles").getByText("Still frame", { exact: true }).click();
  await queue.getByRole("button", { name: "Render frame" }).click();
  await expect(queue.getByText("Rendered · QA not run", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(queue.getByText(/renders\/output-.*\/frame-.*\.png/)).toBeVisible();
  await expect(receipt).toContainText("rendered unchecked");
  await expect(receipt).toContainText("exact timeline composition");
  const selectedOutputCard = queue.locator(".output-card.active");
  await selectedOutputCard.getByRole("button", { name: "Open", exact: true }).click();
  const artifactDialog = page.getByRole("dialog", { name: "Immutable render artifact" });
  await expect(artifactDialog).toBeVisible();
  await expect(artifactDialog).toContainText("SHA-256 verified");
  const artifactImage = page.getByTestId("artifact-viewer-image");
  await expect(artifactImage).toBeVisible();
  expect(
    await artifactImage.evaluate((image: HTMLImageElement) => ({
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  ).toEqual({ complete: true, width: 1920, height: 1080 });
  await artifactDialog.getByRole("button", { name: "Close artifact viewer" }).click();
  await expect(artifactDialog).toHaveCount(0);

  await receipt.getByRole("button", { name: "Run output QA" }).click();
  await expect(receipt).toContainText("qa passed", { timeout: 20_000 });
  await expect(receipt).toContainText("Artifact bytes and ffprobe version");
  const checklistFrames = await receipt.locator(".qa-check strong").allTextContents();
  expect(checklistFrames).toEqual([
    `Frame ${uploadedFrame}`,
    `Frame ${uploadedFrame}`,
    `Frame ${uploadedFrame}`,
  ]);
  await receipt.getByText("Show immutable receipt JSON").click();
  await expect(receipt.locator(".manifest")).toContainText('"status": "probed"');
  await expect(receipt.locator(".manifest")).toContainText('"hasAudio": false');

  await page.getByLabel("Delivery profiles").getByText("Review proxy", { exact: true }).click();
  await queue.getByRole("button", { name: "Render range" }).click();
  const videoOutput = queue.locator(".output-card.active");
  await expect(videoOutput).toContainText("program.mp4", { timeout: 30_000 });
  await expect(videoOutput).toContainText("rendered unchecked");
  await expect(videoOutput).toContainText("1280×720");
  await receipt.getByRole("button", { name: "Run output QA" }).click();
  await expect(receipt).toContainText("qa passed", { timeout: 30_000 });
  const avEvidence = await authenticatedAvEvidence(page);
  expect(avEvidence.output).toMatchObject({
    profileId: "profile-review-proxy",
    lifecycleState: "qa_passed",
    scope: {
      kind: "in-out",
      startFrame: uploadedFrame,
      endFrameExclusive: String(Number(uploadedFrame) + 3),
    },
    primaryPath: expect.stringMatching(/renders\/output-[^/]+\/program\.mp4$/u),
    audioEvidencePath: expect.stringMatching(/renders\/output-[^/]+\/program-audio-mix\.wav$/u),
  });
  expect(avEvidence.receipt).toMatchObject({
    audioStatus: "measured",
    durationFrames: "3",
    approval: null,
    delivered: false,
  });
  expect(avEvidence.qa).toMatchObject({
    state: "qa_passed",
    probeStatus: "probed",
    hasVideo: true,
    hasAudio: true,
    videoStreams: 1,
    audioStreams: 1,
    audioStatus: "passed",
  });
  await expect(page.getByTestId("server-status")).toContainText("Local · live");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await monitor.getByRole("button", { name: "Capture exact", exact: true }).click();
  await expect(page.getByText("Exact fidelity frame completed", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const exactCapture = await page.evaluate(async () => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) return null;
    const response = await fetch(`${session.serverOrigin}/api/v1/captures`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const envelope = (await response.json()) as {
      readonly data?: readonly Readonly<Record<string, unknown>>[];
    };
    return envelope.data?.find((capture) => typeof capture.renderOutputId === "string") ?? null;
  });
  expect(exactCapture).toMatchObject({
    frame: uploadedFrame,
    truthMode: "rendered-fidelity",
    quality: "full",
  });
  expect(exactCapture?.renderOutputId).toMatch(/^output-/u);
  await timeline
    .getByRole("button", { name: /owner-review\.png/ })
    .first()
    .click();
  for (const captureMode of [
    {
      menuName: "Selected clip only Exact final-compositor isolation",
      completed: "Isolated clip completed",
    },
    {
      menuName: "Before effects Stored source with shared properties reset",
      completed: "Before effects completed",
    },
    {
      menuName: "Alpha inspection Exact transparent-background PNG",
      completed: "Alpha inspection completed",
    },
    {
      menuName: "Review range Exact PNG sequence for marked I/O range",
      completed: "Review range completed",
    },
    {
      menuName: "Contact sheet Six exact samples from marked I/O range",
      completed: "Contact sheet completed",
    },
  ] as const) {
    await monitor.getByRole("button", { name: "Open capture modes" }).click();
    const item = monitor.getByRole("menuitem", { name: captureMode.menuName });
    await expect(item).toBeEnabled();
    await item.click();
    await expect(page.getByText(captureMode.completed, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  }
  await page.getByRole("button", { name: "Deliver", exact: true }).click();
  // The queue contains the authored still, the review proxy, and the immutable
  // still created by Capture exact. The specialized capture modes persist
  // capture evidence without publishing additional delivery outputs.
  await expect(queue.locator(".output-card")).toHaveCount(3, { timeout: 20_000 });
  const compareButton = queue.locator(".output-card.active").getByRole("button", {
    name: "Compare",
    exact: true,
  });
  await expect(compareButton).toBeEnabled();
  await compareButton.click();
  const comparisonDialog = page.getByRole("dialog", { name: "Immutable output comparison" });
  await expect(comparisonDialog).toBeVisible();
  await expect(comparisonDialog).toContainText("Both hashes verified");
  await expect(comparisonDialog).toContainText("no simulated difference result");
  for (const testId of ["comparison-current-image", "comparison-reference-image"] as const) {
    const image = page.getByTestId(testId);
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]),
    ).toEqual([1920, 1080]);
  }
  await comparisonDialog.getByRole("button", { name: "Close output comparison" }).click();
  await expect(comparisonDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expectRevisionIdentityAligned(page);
});

const expectRevisionIdentityAligned = async (page: Page): Promise<void> => {
  const header = page.locator(".project-identity");
  const monitorIdentity = page.getByLabel("Monitor artifact identity");
  await expect
    .poll(async () => {
      const [headerId, headerNumber, monitorId, monitorNumber, monitorText] = await Promise.all([
        header.getAttribute("data-revision-id"),
        header.getAttribute("data-revision-number"),
        monitorIdentity.getAttribute("data-revision-id"),
        monitorIdentity.getAttribute("data-revision-number"),
        monitorIdentity.textContent(),
      ]);
      return (
        headerId !== null &&
        headerNumber !== null &&
        headerId === monitorId &&
        headerNumber === monitorNumber &&
        !monitorText?.includes("rev 428")
      );
    })
    .toBe(true);
};

const moveImportedAudioToFrame = async (
  page: Page,
  fileName: string,
  frame: string,
): Promise<Readonly<{ startFrame: string; hasAudio: boolean; kind: string }>> =>
  page.evaluate(
    async ({ fileName: requestedFileName, frame: requestedFrame }) => {
      const session = window.__CHAI_STUDIO_SESSION__;
      if (session === undefined) throw new Error("Authenticated Studio session is unavailable.");
      const headers = {
        authorization: `Bearer ${session.token}`,
        "x-chai-csrf-token": session.token,
        "content-type": "application/json",
      };
      const snapshotResponse = await fetch(`${session.serverOrigin}/api/v1/projects/current/snapshot`, {
        headers,
      });
      const snapshotEnvelope = (await snapshotResponse.json()) as {
        readonly data?: {
          readonly pointer?: { readonly revisionId?: string };
          readonly project?: { readonly projectId?: string };
          readonly assets?: {
            readonly assets?: readonly {
              readonly id?: string;
              readonly path?: string;
              readonly kind?: string;
              readonly hasAudio?: boolean;
            }[];
          };
          readonly timeline?: {
            readonly tracks?: readonly {
              readonly id?: string;
              readonly clips?: readonly {
                readonly id?: string;
                readonly assetId?: string | null;
                readonly startFrame?: string;
              }[];
            }[];
          };
        };
      };
      const snapshot = snapshotEnvelope.data;
      const asset = snapshot?.assets?.assets?.find((candidate) =>
        candidate.path?.endsWith(requestedFileName),
      );
      if (asset?.id === undefined) throw new Error("Imported audio asset is unavailable.");
      const clipAndTrack = snapshot?.timeline?.tracks
        ?.flatMap((track) => (track.clips ?? []).map((clip) => ({ clip, track })))
        .find(({ clip }) => clip.assetId === asset.id);
      if (clipAndTrack?.clip.id === undefined || clipAndTrack.track.id === undefined) {
        throw new Error("Imported audio clip is unavailable.");
      }
      const baseRevisionId = snapshot?.pointer?.revisionId;
      const projectId = snapshot?.project?.projectId;
      if (baseRevisionId === undefined || projectId === undefined) {
        throw new Error("Project authority is unavailable.");
      }
      const nonce = globalThis.crypto.randomUUID();
      const commandResponse = await fetch(`${session.serverOrigin}/api/v1/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          schemaVersion: "1.0.0",
          commandId: `command-av-setup-${nonce}`,
          idempotencyId: `idempotency-av-setup-${nonce}`,
          actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
          projectId,
          correlationId: `correlation-av-setup-${nonce}`,
          issuedAt: new Date().toISOString(),
          capability: { name: "timeline-edit", version: "1.0.0" },
          payloadVersion: "1.0.0",
          affectedEntityIds: [clipAndTrack.clip.id, clipAndTrack.track.id],
          declaredScope: "mutation",
          validationOnly: false,
          baseRevisionId,
          authorizationId: null,
          kind: "timeline.edit",
          payload: {
            operation: {
              kind: "clips.move",
              moves: [
                {
                  clipId: clipAndTrack.clip.id,
                  trackId: clipAndTrack.track.id,
                  start: requestedFrame,
                },
              ],
            },
          },
        }),
      });
      if (!commandResponse.ok)
        throw new Error(`Audio placement failed with ${String(commandResponse.status)}.`);
      return { startFrame: requestedFrame, hasAudio: asset.hasAudio === true, kind: asset.kind ?? "unknown" };
    },
    { fileName, frame },
  );

const authenticatedAvEvidence = async (
  page: Page,
): Promise<
  Readonly<{
    output: Readonly<Record<string, unknown>>;
    receipt: Readonly<Record<string, unknown>>;
    qa: Readonly<Record<string, unknown>>;
  }>
> =>
  page.evaluate(async () => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) throw new Error("Authenticated Studio session is unavailable.");
    const headers = { authorization: `Bearer ${session.token}` };
    const outputsResponse = await fetch(`${session.serverOrigin}/api/v1/renders/outputs`, { headers });
    const outputsEnvelope = (await outputsResponse.json()) as {
      readonly data?: readonly {
        readonly id?: string;
        readonly profile?: { readonly id?: string };
        readonly scope?: Readonly<Record<string, unknown>>;
        readonly lifecycleState?: string;
        readonly artifacts?: readonly {
          readonly relativePath?: string;
          readonly primary?: boolean;
        }[];
      }[];
    };
    const output = outputsEnvelope.data?.find(
      (candidate) => candidate.profile?.id === "profile-review-proxy",
    );
    if (output?.id === undefined) throw new Error("Authenticated A/V output is unavailable.");
    const [receiptResponse, qaResponse] = await Promise.all([
      fetch(`${session.serverOrigin}/api/v1/renders/outputs/${output.id}/receipt`, { headers }),
      fetch(`${session.serverOrigin}/api/v1/renders/outputs/${output.id}/qa`, { headers }),
    ]);
    const receiptEnvelope = (await receiptResponse.json()) as {
      readonly data?: {
        readonly base?: {
          readonly audio?: { readonly status?: string };
          readonly dag?: {
            readonly range?: { readonly startFrame?: string; readonly endFrameExclusive?: string };
          };
          readonly approval?: unknown;
          readonly delivered?: boolean;
        };
      };
    };
    const qaEnvelope = (await qaResponse.json()) as {
      readonly data?: {
        readonly latest?: {
          readonly state?: string;
          readonly audio?: { readonly status?: string };
          readonly primaryArtifactProbe?: {
            readonly status?: string;
            readonly inspection?: {
              readonly hasVideo?: boolean;
              readonly hasAudio?: boolean;
              readonly videoStreams?: readonly unknown[];
              readonly audioStreams?: readonly unknown[];
            };
          };
        };
      };
    };
    const base = receiptEnvelope.data?.base;
    const range = base?.dag?.range;
    const latest = qaEnvelope.data?.latest;
    const inspection = latest?.primaryArtifactProbe?.inspection;
    return {
      output: {
        profileId: output.profile?.id,
        lifecycleState: output.lifecycleState,
        scope: output.scope,
        primaryPath: output.artifacts?.find((artifact) => artifact.primary)?.relativePath,
        audioEvidencePath: output.artifacts?.find((artifact) =>
          artifact.relativePath?.endsWith("program-audio-mix.wav"),
        )?.relativePath,
      },
      receipt: {
        audioStatus: base?.audio?.status,
        durationFrames:
          range?.startFrame === undefined || range.endFrameExclusive === undefined
            ? null
            : (BigInt(range.endFrameExclusive) - BigInt(range.startFrame)).toString(10),
        approval: base?.approval,
        delivered: base?.delivered,
      },
      qa: {
        state: latest?.state,
        probeStatus: latest?.primaryArtifactProbe?.status,
        hasVideo: inspection?.hasVideo,
        hasAudio: inspection?.hasAudio,
        videoStreams: inspection?.videoStreams?.length,
        audioStreams: inspection?.audioStreams?.length,
        audioStatus: latest?.audio?.status,
      },
    };
  });

const authoritativeOpacityEvidence = async (
  page: Page,
): Promise<
  Readonly<{ clipOpacity: number | null; blendMode: string | null; opacityKeyValues: readonly number[] }>
> =>
  page.evaluate(async () => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) throw new Error("Authenticated Studio session is unavailable.");
    const response = await fetch(`${session.serverOrigin}/api/v1/projects/current/snapshot`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const envelope = (await response.json()) as {
      readonly data?: {
        readonly timeline?: {
          readonly tracks?: readonly {
            readonly clips?: readonly {
              readonly id?: string;
              readonly name?: string;
              readonly properties?: Readonly<Record<string, { readonly value?: unknown }>>;
            }[];
          }[];
          readonly keyframes?: readonly {
            readonly ownerEntityId?: string;
            readonly propertyPath?: string;
            readonly value?: unknown;
          }[];
        };
      };
    };
    const interview = envelope.data?.timeline?.tracks
      ?.flatMap((track) => track.clips ?? [])
      .find((clip) => clip.name === "Interview A");
    const clipOpacity = interview?.properties?.["transform.opacity"]?.value;
    const blendMode = interview?.properties?.["composite.blendMode"]?.value;
    const opacityKeyValues = (envelope.data?.timeline?.keyframes ?? [])
      .filter(
        (keyframe) =>
          keyframe.ownerEntityId === interview?.id && keyframe.propertyPath === "transform.opacity",
      )
      .map((keyframe) => keyframe.value)
      .filter((value): value is number => typeof value === "number");
    return {
      clipOpacity: typeof clipOpacity === "number" ? clipOpacity : null,
      blendMode: typeof blendMode === "string" ? blendMode : null,
      opacityKeyValues,
    };
  });

const importedAssetStartFrame = async (page: Page, fileName: string): Promise<string | null> =>
  page.evaluate(async (requestedFileName) => {
    const session = window.__CHAI_STUDIO_SESSION__;
    if (session === undefined) return null;
    const response = await fetch(`${session.serverOrigin}/api/v1/projects/current/snapshot`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const envelope = (await response.json()) as {
      readonly data?: {
        readonly assets?: { readonly assets?: readonly Readonly<Record<string, unknown>>[] };
        readonly timeline?: {
          readonly tracks?: readonly {
            readonly clips?: readonly Readonly<Record<string, unknown>>[];
          }[];
        };
      };
    };
    const asset = envelope.data?.assets?.assets?.find(
      (candidate) => typeof candidate.path === "string" && candidate.path.endsWith(requestedFileName),
    );
    if (typeof asset?.id !== "string") return null;
    const clip = envelope.data?.timeline?.tracks
      ?.flatMap((track) => track.clips ?? [])
      .find((candidate) => candidate.assetId === asset.id);
    return typeof clip?.startFrame === "string" ? clip.startFrame : null;
  }, fileName);

const toneWave = (sampleRate: number, sampleCount: number, frequency: number, amplitude: number): Buffer => {
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + sampleCount * 2, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude;
    bytes.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return bytes;
};

const frameNumber = async (locator: Locator): Promise<number> => {
  const text = await locator.textContent();
  const match = /Frame (\d+)/u.exec(text ?? "");
  if (match?.[1] === undefined) throw new Error(`Unable to parse frame label: ${text ?? "empty"}`);
  return Number(match[1]);
};
