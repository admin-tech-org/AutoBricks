import { useState } from "react";

const MODES = ["landing-page", "page", "section"];

export function NewJobForm({ onCreate }: { onCreate: (url: string, mode: string) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState(MODES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!url.trim()) {
      setError("Enter a URL first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(url.trim(), mode);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ flex: 1 }}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
      {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
