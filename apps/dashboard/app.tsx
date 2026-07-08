import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { JobList } from "./components/JobList";
import { NewJobForm } from "./components/NewJobForm";
import { JobDetail } from "./components/JobDetail";

// ---------------------------------------------------------------------------
// Minimal local API payload types (deliberately NOT imported from workspace
// packages — the dashboard bundle stays self-contained).
// ---------------------------------------------------------------------------

export type JobStatus =
  | "queued"
  | "capturing"
  | "analyzing"
  | "generating"
  | "validating"
  | "exporting"
  | "done"
  | "failed";

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  mode: string;
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SectionInfo {
  id: string;
  type: string;
  layout: string;
  box?: Box;
  confidence?: number;
  componentCount?: number;
}

export interface ValidationScores {
  score: number;
  layoutScore: number;
  colorScore: number;
  spacingScore: number;
  contentScore: number;
  warnings: string[];
}

export interface BricksElement {
  id: string;
  name: string;
  parent: string | 0;
  children: string[];
  settings?: Record<string, unknown>;
}

export interface BricksTemplate {
  content: BricksElement[];
  source?: string;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Root app: sidebar (job list + new job form) + main pane (selected job).
// ---------------------------------------------------------------------------

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchJson<Job[] | { jobs: Job[] }>("/jobs");
      const list = Array.isArray(data) ? data : Array.isArray(data.jobs) ? data.jobs : [];
      setJobs(list);
      setJobsError(null);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const timer = window.setInterval(loadJobs, 3000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  const createJob = useCallback(
    async (url: string, mode: string) => {
      const created = await fetchJson<{ jobId?: string; id?: string }>("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode }),
      });
      const id = created.jobId ?? created.id ?? null;
      if (id) setSelectedId(id);
      await loadJobs();
    },
    [loadJobs]
  );

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside
        style={{
          width: 300,
          minWidth: 300,
          borderRight: "1px solid #1c2436",
          display: "flex",
          flexDirection: "column",
          background: "#0d1220",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #1c2436" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Bricks <span style={{ color: "#635bff" }}>CDP</span> Generator
          </div>
        </div>
        <div style={{ padding: 12, borderBottom: "1px solid #1c2436" }}>
          <NewJobForm onCreate={createJob} />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {jobsError && (
            <div style={{ color: "#f87171", padding: 12, fontSize: 12 }}>Failed to load jobs: {jobsError}</div>
          )}
          <JobList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </aside>
      <main style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {selected ? (
          <JobDetail job={selected} />
        ) : (
          <div style={{ color: "#6b7280", marginTop: 80, textAlign: "center" }}>
            Select a job on the left, or create a new one.
          </div>
        )}
      </main>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);
