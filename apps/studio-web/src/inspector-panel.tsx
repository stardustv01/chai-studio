import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button } from "@chai-studio/ui-components";
import type { TimelineEditCommand } from "@chai-studio/timeline/browser";
import type { StudioSnapshot } from "./types.js";
import {
  fieldDraftValue,
  inspectorFields,
  inspectorImpact,
  parseInspectorDraft,
  resolveInspectorContext,
  type InspectorField,
} from "./inspector-contract.js";
import { ChaiIcon } from "./chai-icon.js";

interface ContextualInspectorProps {
  readonly snapshot: StudioSnapshot;
  readonly onCommand: (command: TimelineEditCommand) => void;
  readonly onInspectAsset: (assetId: string) => Promise<boolean>;
  readonly assetInspectionAvailable: boolean;
}

export const ContextualInspector = ({
  assetInspectionAvailable,
  onCommand,
  onInspectAsset,
  snapshot,
}: ContextualInspectorProps) => {
  const context = resolveInspectorContext(snapshot.timeline, snapshot.selection.assetIds);
  const fields = inspectorFields(snapshot.timeline, context);
  const impact = inspectorImpact(snapshot.timeline, context);
  const groups = [...new Set(fields.map((field) => field.group))];
  const clips = context.clipIds.map((id) => snapshot.timeline.clips[id]).filter((clip) => clip !== undefined);
  const nativeEngine = clips.length === 1 ? clips[0]?.engine : null;
  const assetId = clips[0]?.assetId ?? null;
  const sourcePath = clips[0]?.metadata.sourcePath ?? null;
  const [requestStatus, setRequestStatus] = useState<string | null>(null);

  return (
    <div className="panel-content contextual-inspector" aria-label="Contextual inspector">
      <div className="panel-titlebar">
        <strong>Inspector</strong>
        <Badge tone={impact.validation === "valid" ? "ready" : "attention"}>
          {impact.validation === "valid" ? "Valid" : "Warning"}
        </Badge>
      </div>
      <div className="panel-scroll">
        <div className="inspector-identity">
          <div>
            <strong>{context.title}</strong>
            <small>{context.subtitle}</small>
          </div>
          <Badge tone={context.kind === "clips" ? "info" : "neutral"}>{context.kind}</Badge>
        </div>
        {context.kind === "none" ? (
          <div className="inspector-empty">
            Select a clip, keyframe, marker, transition, bridge, caption, track, or asset.
          </div>
        ) : null}
        {groups.map((group) => (
          <section className="inspector-section" key={group}>
            <div className="inspector-section__title">
              <h3>{group}</h3>
              {group.includes("native") ? <Badge tone="info">Native</Badge> : <Badge>Shared</Badge>}
            </div>
            <div className="inspector-fields">
              {fields
                .filter((field) => field.group === group)
                .map((field) => (
                  <InspectorFieldControl field={field} onCommand={onCommand} key={field.path} />
                ))}
            </div>
          </section>
        ))}
        {nativeEngine === "remotion" || nativeEngine === "hyperframes" ? (
          <section className="inspector-section native-contract">
            <div className="inspector-section__title">
              <h3>{nativeEngine === "remotion" ? "Remotion composition" : "HyperFrames composition"}</h3>
              <Badge tone="ready">Validated descriptor</Badge>
            </div>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{sourcePath ?? "Source path unavailable"}</dd>
              </div>
              <div>
                <dt>Metadata</dt>
                <dd>{clips[0]?.metadata.calculatedMetadata ?? "Calculated metadata valid"}</dd>
              </div>
              <div>
                <dt>Ownership</dt>
                <dd>Native capabilities preserved</dd>
              </div>
            </dl>
            <div className="inspector-actions">
              <Button
                disabled={!assetInspectionAvailable || assetId === null}
                title={
                  assetInspectionAvailable
                    ? "Validate the registered native source manifest."
                    : "Requires the authenticated local project service."
                }
                onClick={() => {
                  if (assetId === null) return;
                  setRequestStatus("Source validation queued…");
                  void onInspectAsset(assetId).then((accepted) => {
                    setRequestStatus(
                      accepted
                        ? `Validation job accepted for ${assetId}.`
                        : "Source validation was not accepted. Open diagnostics for details.",
                    );
                  });
                }}
              >
                <ChaiIcon name="validate-source" size={16} /> Validate source
              </Button>
              <Button
                disabled
                title="Native composition proxy baking is not implemented in this build; final rendering uses the validated source manifest."
              >
                Proxy bake unavailable
              </Button>
            </div>
            {requestStatus === null ? null : (
              <p className="inspector-request" role="status">
                {requestStatus}
              </p>
            )}
          </section>
        ) : null}
        <section className="inspector-section">
          <div className="inspector-section__title">
            <h3>Validation & render impact</h3>
            <Badge tone={impact.validation === "valid" ? "ready" : "attention"}>{impact.validation}</Badge>
          </div>
          <div className="impact-grid">
            <span>Dependencies</span>
            <strong>{impact.dependencySummary}</strong>
            <span>Cache</span>
            <strong>{impact.cacheSummary}</strong>
            <span>Affected render</span>
            <strong>{impact.affectedRange}</strong>
          </div>
          {impact.warning === null ? null : <p className="warning-note">{impact.warning}</p>}
        </section>
      </div>
    </div>
  );
};

const InspectorFieldControl = ({
  field,
  onCommand,
}: {
  readonly field: InspectorField;
  readonly onCommand: (command: TimelineEditCommand) => void;
}) => {
  const authoritativeDraft = fieldDraftValue(field);
  const ownerKey = `${field.path}:${field.clipIds.join(",")}`;
  const [draft, setDraft] = useState(authoritativeDraft);
  const [error, setError] = useState<string | null>(null);
  const lastSubmittedDraft = useRef<string | null>(null);
  const editable = field.state.safeToEdit;
  const inputId = `inspector-${field.path.replaceAll(".", "-")}`;

  useEffect(() => {
    setDraft(authoritativeDraft);
    setError(null);
  }, [authoritativeDraft, ownerKey]);

  useEffect(() => {
    lastSubmittedDraft.current = null;
  }, [ownerKey]);

  const commitDraft = (value: string): void => {
    if (lastSubmittedDraft.current === value) return;
    const parsed = parseInspectorDraft(field, value);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    lastSubmittedDraft.current = value;
    onCommand({
      kind: "clips.properties.update",
      clipIds: field.clipIds,
      changes: { [field.path]: parsed.value },
    });
    setError(null);
  };
  const commit = (): void => {
    commitDraft(draft);
  };
  const cancel = (): void => {
    const value = fieldDraftValue(field);
    setDraft(value);
    lastSubmittedDraft.current = value;
    setError(null);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>): void => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") cancel();
  };
  const input =
    field.state.unit === "enum" && field.options.length > 0 ? (
      <select
        id={inputId}
        value={draft}
        disabled={!editable}
        onFocus={() => {
          lastSubmittedDraft.current = null;
        }}
        onChange={(event) => {
          const next = event.target.value;
          lastSubmittedDraft.current = null;
          setDraft(next);
          commitDraft(next);
        }}
        onBlur={commit}
        onKeyDown={keyDown}
      >
        {field.mixed ? <option value="">Mixed</option> : null}
        {field.options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    ) : field.state.unit === "boolean" ? (
      <select
        id={inputId}
        value={draft}
        disabled={!editable}
        onFocus={() => {
          lastSubmittedDraft.current = null;
        }}
        onChange={(event) => {
          const next = event.target.value;
          lastSubmittedDraft.current = null;
          setDraft(next);
          commitDraft(next);
        }}
        onBlur={commit}
        onKeyDown={keyDown}
      >
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    ) : (
      <input
        id={inputId}
        type={field.state.unit === "color" ? "color" : "text"}
        inputMode={typeof field.value === "number" || Array.isArray(field.value) ? "decimal" : undefined}
        value={draft}
        placeholder={field.mixed ? "Mixed" : undefined}
        disabled={!editable}
        onFocus={() => {
          lastSubmittedDraft.current = null;
        }}
        onChange={(event) => {
          lastSubmittedDraft.current = null;
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={keyDown}
      />
    );
  return (
    <div className={`inspector-field${error === null ? "" : " inspector-field--error"}`}>
      <div className="inspector-field__label">
        <label htmlFor={inputId}>{field.label}</label>
        <span>{field.state.unit ?? "value"}</span>
      </div>
      <div className="inspector-field__control">
        {input}
        <button
          type="button"
          title="Reset to default"
          aria-label={`Reset ${field.label}`}
          disabled={!editable}
          onClick={() => {
            const value = field.state.defaultValue;
            onCommand({
              kind: "clips.properties.update",
              clipIds: field.clipIds,
              changes: { [field.path]: value },
            });
            const nextDraft = Array.isArray(value) ? value.join(", ") : String(value);
            lastSubmittedDraft.current = nextDraft;
            setDraft(nextDraft);
            setError(null);
          }}
        >
          <ChaiIcon name="undo" size={14} />
        </button>
      </div>
      {typeof field.value === "number" &&
      field.state.minimum !== null &&
      field.state.maximum !== null &&
      field.state.maximum - field.state.minimum <= 1_000 ? (
        <input
          className="inspector-scrubber"
          type="range"
          aria-label={`${field.label} scrub`}
          min={field.state.minimum}
          max={field.state.maximum}
          step={field.state.step ?? "any"}
          value={strictNumericDraft(draft) ? draft : String(field.value)}
          disabled={!editable}
          onFocus={() => {
            lastSubmittedDraft.current = null;
          }}
          onChange={(event) => {
            lastSubmittedDraft.current = null;
            setDraft(event.target.value);
          }}
          onPointerUp={(event) => {
            commitDraft(event.currentTarget.value);
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith("Arrow")) commitDraft(event.currentTarget.value);
          }}
        />
      ) : null}
      <div className="inspector-field__meta">
        <Badge
          tone={
            field.state.capability === "bake_required"
              ? "attention"
              : field.state.capability === "unsupported"
                ? "danger"
                : "neutral"
          }
        >
          {field.state.capability.replaceAll("_", " ")}
        </Badge>
        <span>{field.state.ownership === "shared" ? "Shared ownership" : "Engine ownership"}</span>
        {field.state.keyframeable ? (
          <span>
            <ChaiIcon name="keyframe" size={14} /> Keyframeable
          </span>
        ) : null}
      </div>
      {field.state.nativeAnimation ? (
        <div className="native-warning">
          <span>Native animation owns this property. Editing is locked to prevent double animation.</span>
          <Button
            variant="danger"
            onClick={() => {
              onCommand({
                kind: "clips.properties.convert-to-shared",
                clipIds: field.clipIds,
                propertyPaths: [field.path],
              });
            }}
          >
            Convert to shared
          </Button>
        </div>
      ) : null}
      {error === null ? null : (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
};

const strictNumericDraft = (value: string): boolean => /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
