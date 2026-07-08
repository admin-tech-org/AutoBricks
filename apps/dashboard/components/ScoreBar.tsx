export function ScoreBar({ label, value }: { label: string; value: number | undefined }) {
  const v = typeof value === "number" && isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  const color = v === null ? "#6b7280" : v >= 0.8 ? "#34d399" : v >= 0.6 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
      <span style={{ width: 90, color: "#9ca3af", fontSize: 12 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: "#1c2436", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${v === null ? 0 : v * 100}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span style={{ width: 44, textAlign: "right", fontVariantNumeric: "tabular-nums", color }}>
        {v === null ? "—" : v.toFixed(2)}
      </span>
    </div>
  );
}
