import type { Job, JobStatus } from "../app";

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "#6b7280",
  capturing: "#38bdf8",
  analyzing: "#38bdf8",
  generating: "#fbbf24",
  validating: "#fbbf24",
  exporting: "#a78bfa",
  done: "#34d399",
  failed: "#f87171",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const color = STATUS_COLORS[status] ?? "#6b7280";
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}55`,
        background: `${color}18`,
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

export function JobList({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return <div style={{ color: "#6b7280", padding: 12, fontSize: 12 }}>No jobs yet.</div>;
  }
  return (
    <div>
      {jobs.map((job) => (
        <div
          key={job.id}
          onClick={() => onSelect(job.id)}
          style={{
            padding: "10px 14px",
            cursor: "pointer",
            borderBottom: "1px solid #131a2b",
            background: job.id === selectedId ? "#161f36" : "transparent",
            borderLeft: job.id === selectedId ? "3px solid #635bff" : "3px solid transparent",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
              }}
              title={job.url}
            >
              {job.url}
            </span>
            <StatusBadge status={job.status} />
          </div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
            {job.id} · {job.mode}
          </div>
          {job.error_message && (
            <div style={{ color: "#f87171", fontSize: 11, marginTop: 2 }}>{job.error_message}</div>
          )}
        </div>
      ))}
    </div>
  );
}
