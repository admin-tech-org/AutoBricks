import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Box, BricksElement, BricksTemplate, Job, SectionInfo, ValidationScores } from "../app";
import { fetchJson } from "../app";
import { StatusBadge } from "./JobList";
import { ScoreBar } from "./ScoreBar";

const TABS = ["Screenshots", "Sections", "Bricks structure", "IR editor", "Report"] as const;
type Tab = (typeof TABS)[number];

function ErrorText({ msg }: { msg: string }) {
  return <div style={{ color: "#f87171", padding: "12px 0", fontSize: 13 }}>{msg}</div>;
}

function Muted({ children }: { children?: ReactNode }) {
  return <div style={{ color: "#6b7280", padding: "12px 0", fontSize: 13 }}>{children}</div>;
}

// --- Screenshots tab --------------------------------------------------------

function Shot({ label, src }: { label: string; src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "#9ca3af", fontSize: 12, margin: "8px 0 4px" }}>{label}</div>
      {failed ? (
        <Muted>not available</Muted>
      ) : (
        <a href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt={label}
            onError={() => setFailed(true)}
            style={{ maxWidth: "100%", border: "1px solid #1c2436", borderRadius: 6, display: "block" }}
          />
        </a>
      )}
    </div>
  );
}

function ScreenshotsTab({ jobId }: { jobId: string }) {
  const base = `/storage/screenshots/${jobId}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      <Shot label="Desktop" src={`${base}/desktop.png`} />
      <Shot label="Tablet" src={`${base}/tablet.png`} />
      <Shot label="Mobile" src={`${base}/mobile.png`} />
      <Shot label="Full page" src={`${base}/full-page.png`} />
    </div>
  );
}

// --- Sections tab (detected boxes over the full-page screenshot) ------------

function SectionsTab({ jobId }: { jobId: string }) {
  const [sections, setSections] = useState<SectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setSections(null);
    setError(null);
    fetchJson<any>(`/jobs/${jobId}/report`)
      .then((rep) => {
        const secs: SectionInfo[] = rep?.sections ?? rep?.analysis?.sections ?? [];
        setSections(Array.isArray(secs) ? secs : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [jobId]);

  if (error) return <ErrorText msg={`Could not load report: ${error}`} />;
  if (!sections) return <Muted>Loading…</Muted>;

  const boxes = sections.filter((s): s is SectionInfo & { box: Box } => !!s.box);
  // Page width the boxes are expressed against (layout pageWidth); fall back
  // to the max box extent, then to the desktop viewport.
  const pageWidth = Math.max(1440, ...boxes.map((s) => s.box.x + s.box.width));

  return (
    <div>
      {sections.length === 0 && <Muted>No sections detected yet.</Muted>}
      <div style={{ position: "relative", maxWidth: 900 }}>
        <img
          src={`/storage/screenshots/${jobId}/full-page.png`}
          alt="full page"
          onLoad={(e) => {
            const el = e.currentTarget;
            setImg({ w: el.naturalWidth || 1, h: el.naturalHeight || 1 });
          }}
          style={{ width: "100%", display: "block", border: "1px solid #1c2436", borderRadius: 6 }}
        />
        {img &&
          boxes.map((s) => {
            // Screenshot pixels may be scaled vs layout px (device pixel ratio).
            const scale = img.w / pageWidth;
            const leftPct = ((s.box.x * scale) / img.w) * 100;
            const widthPct = ((s.box.width * scale) / img.w) * 100;
            const topPct = ((s.box.y * scale) / img.h) * 100;
            const heightPct = ((s.box.height * scale) / img.h) * 100;
            return (
              <div
                key={s.id}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  border: "2px solid #635bff",
                  background: "rgba(99,91,255,0.08)",
                  borderRadius: 4,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 2,
                    background: "#635bff",
                    color: "#fff",
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 3,
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.type}
                  {typeof s.confidence === "number" ? ` · ${(s.confidence * 100).toFixed(0)}%` : ""}
                </span>
              </div>
            );
          })}
      </div>
      <div style={{ marginTop: 10, color: "#9ca3af", fontSize: 12 }}>
        {boxes.length} of {sections.length} detected sections have bounding boxes.
      </div>
    </div>
  );
}

// --- Bricks structure tab ----------------------------------------------------

function settingsSummary(settings?: Record<string, unknown>): string {
  if (!settings) return "";
  const bits: string[] = [];
  const text = settings["text"];
  if (typeof text === "string" && text.trim()) {
    bits.push(`"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`);
  }
  if (typeof settings["tag"] === "string") bits.push(String(settings["tag"]));
  if (typeof settings["_direction"] === "string") bits.push(`dir:${settings["_direction"]}`);
  const img = settings["image"] as Record<string, unknown> | undefined;
  if (img && typeof img === "object" && typeof (img as any).url === "string") bits.push("img");
  return bits.join("  ");
}

function TreeNode({ el, byId, depth }: { el: BricksElement; byId: Map<string, BricksElement>; depth: number }) {
  return (
    <>
      <div style={{ padding: `2px 0 2px ${depth * 18}px`, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>
        <span style={{ color: "#635bff" }}>{el.name}</span>
        <span style={{ color: "#4b5563" }}> #{el.id}</span>
        <span style={{ color: "#9ca3af", marginLeft: 8 }}>{settingsSummary(el.settings)}</span>
      </div>
      {(el.children || []).map((cid) => {
        const child = byId.get(cid);
        return child ? <TreeNode key={cid} el={child} byId={byId} depth={depth + 1} /> : null;
      })}
    </>
  );
}

function StructureTab({ jobId }: { jobId: string }) {
  const [template, setTemplate] = useState<BricksTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTemplate(null);
    setError(null);
    fetchJson<BricksTemplate>(`/jobs/${jobId}/download-json`)
      .then(setTemplate)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [jobId]);

  if (error) return <ErrorText msg={`Could not load template: ${error}`} />;
  if (!template) return <Muted>Loading…</Muted>;
  const content = Array.isArray(template.content) ? template.content : [];
  const byId = new Map(content.map((el) => [el.id, el] as const));
  const roots = content.filter((el) => el.parent === 0);
  if (roots.length === 0) return <Muted>Template has no root elements yet.</Muted>;
  return (
    <div style={{ background: "#0d1220", border: "1px solid #1c2436", borderRadius: 6, padding: 12, overflowX: "auto" }}>
      {roots.map((el) => (
        <TreeNode key={el.id} el={el} byId={byId} depth={0} />
      ))}
    </div>
  );
}

// --- IR editor tab -----------------------------------------------------------

function IrEditorTab({ jobId }: { jobId: string }) {
  const [text, setText] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    fetch(`/jobs/${jobId}/ir`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((body) => {
        try {
          setText(JSON.stringify(JSON.parse(body), null, 2));
        } catch {
          setText(body);
        }
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    setLoaded(false);
    setText("");
    setNotice(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const regenerate = async () => {
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`IR is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/jobs/${jobId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setNotice("Regeneration started. The job will re-run generate/validate.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !loaded) return <ErrorText msg={`Could not load IR: ${error}`} />;
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          height: 420,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12.5,
          background: "#0d1220",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        <button className="primary" onClick={regenerate} disabled={busy || !loaded}>
          {busy ? "Regenerating…" : "Regenerate"}
        </button>
        <button onClick={load}>Reload</button>
        {notice && <span style={{ color: "#34d399", fontSize: 12 }}>{notice}</span>}
        {error && loaded && <span style={{ color: "#f87171", fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}

// --- Report tab ---------------------------------------------------------------

function ReportTab({ jobId }: { jobId: string }) {
  const [scores, setScores] = useState<ValidationScores | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScores(null);
    setError(null);
    fetchJson<any>(`/jobs/${jobId}/report`)
      .then((rep) => {
        const v = rep && typeof rep.score === "number" ? rep : rep?.validation ?? rep?.validationReport ?? null;
        if (v && typeof v.score === "number") {
          setScores({ ...v, warnings: Array.isArray(v.warnings) ? v.warnings : [] });
        } else {
          setError("No validation scores in report yet.");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [jobId]);

  if (error) return <ErrorText msg={error} />;
  if (!scores) return <Muted>Loading…</Muted>;
  return (
    <div style={{ maxWidth: 560 }}>
      <ScoreBar label="Overall" value={scores.score} />
      <ScoreBar label="Layout" value={scores.layoutScore} />
      <ScoreBar label="Color" value={scores.colorScore} />
      <ScoreBar label="Spacing" value={scores.spacingScore} />
      <ScoreBar label="Content" value={scores.contentScore} />
      <div style={{ marginTop: 16 }}>
        <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 4 }}>Warnings</div>
        {scores.warnings.length === 0 ? (
          <Muted>No warnings.</Muted>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {scores.warnings.map((w, i) => (
              <li key={i} style={{ color: "#fbbf24", fontSize: 13 }}>
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 14 }}>
        <a href={`/storage/reports/${jobId}/preview.png`} target="_blank" rel="noreferrer">
          Preview screenshot
        </a>
        <a href={`/storage/reports/${jobId}/diff.png`} target="_blank" rel="noreferrer">
          Diff image
        </a>
      </div>
    </div>
  );
}

// --- Job detail (header + tabs) ------------------------------------------------

export function JobDetail({ job }: { job: Job }) {
  const [tab, setTab] = useState<Tab>("Screenshots");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, wordBreak: "break-all" }}>{job.url}</h2>
        <StatusBadge status={job.status} />
        <span style={{ flex: 1 }} />
        <a href={`/jobs/${job.id}/download-json`} download>
          <button>Download template.json</button>
        </a>
        <a href={`/jobs/${job.id}/download-zip`} download>
          <button>Download kit .zip</button>
        </a>
      </div>
      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
        {job.id} · {job.mode} · updated {job.updated_at}
      </div>
      {job.error_message && <ErrorText msg={job.error_message} />}
      <div style={{ borderBottom: "1px solid #1c2436", margin: "14px 0", display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button key={t} className={`tab${t === tab ? " active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Screenshots" && <ScreenshotsTab jobId={job.id} />}
      {tab === "Sections" && <SectionsTab jobId={job.id} />}
      {tab === "Bricks structure" && <StructureTab jobId={job.id} />}
      {tab === "IR editor" && <IrEditorTab jobId={job.id} />}
      {tab === "Report" && <ReportTab jobId={job.id} />}
    </div>
  );
}
