import { Link, Form } from "react-router";

// ── Formatierung ────────────────────────────────────────────────

export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  );
}

export function formatDuration(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTrigger(trigger, orderNumber) {
  if (!trigger) return "—";
  if (trigger === "manual")          return "Manuell";
  if (trigger === "manual:test")     return "Manuell (Test)";
  if (trigger === "manual:bulk-set") return "Bestand setzen";
  if (trigger.includes("orders/create"))    return orderNumber ? `Order #${orderNumber}` : "Order (erstellt)";
  if (trigger.includes("orders/paid"))      return orderNumber ? `Order #${orderNumber} (bezahlt)` : "Order (bezahlt)";
  if (trigger.includes("orders/cancelled")) return orderNumber ? `Order #${orderNumber} (storniert)` : "Order (storniert)";
  return trigger;
}

export function pageUrl(basePath, filters, page) {
  const p = new URLSearchParams();
  if (filters.groupSku)         p.set("sku",    filters.groupSku);
  if (filters.status !== "all") p.set("status", filters.status);
  if (filters.since)            p.set("since",  filters.since);
  if (filters.until)            p.set("until",  filters.until);
  p.set("page", String(page));
  return `${basePath}?${p.toString()}`;
}

// ── Gemeinsame Styles ────────────────────────────────────────────

export const TH = {
  padding: "10px 14px",
  textAlign: "left",
  color: "#6d7175",
  fontWeight: 600,
  fontSize: "13px",
  whiteSpace: "nowrap",
  background: "#f6f6f7",
  borderBottom: "1px solid #e1e3e5",
};

export const TD = {
  padding: "10px 14px",
  fontSize: "13px",
  borderBottom: "1px solid #e1e3e5",
  verticalAlign: "middle",
};

export const LABEL = {
  display: "block",
  fontSize: "13px",
  fontWeight: 500,
  marginBottom: "4px",
  color: "#202223",
};

export const INPUT = {
  padding: "7px 10px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "14px",
  fontFamily: "inherit",
  background: "#fff",
  color: "#202223",
  boxSizing: "border-box",
};

export const BTN_PRIMARY = {
  padding: "7px 16px",
  background: "#008060",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 500,
};

export const BTN_SECONDARY = {
  padding: "7px 14px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "14px",
  color: "#6d7175",
  textDecoration: "none",
  fontFamily: "inherit",
  display: "inline-block",
  background: "#fff",
  cursor: "pointer",
};

export const BTN_DANGER = {
  padding: "7px 16px",
  background: "#d82c0d",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 500,
};

// ── Wiederverwendbare Bausteine ──────────────────────────────────

/** Kleine Statistik-Kacheln (z.B. Gesamt / Erfolgreich / Fehler) */
export function StatBar({ items }) {
  return (
    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
      {items.map((s) => (
        <div
          key={s.label}
          style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px 18px", background: "#fff" }}
        >
          <div style={{ fontSize: "22px", fontWeight: 700, color: s.color || "#202223" }}>{s.value}</div>
          <div style={{ fontSize: "12px", color: "#6d7175" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Filter-Formular (GET) – für alle Log-Seiten */
export function LogFilter({ filters, basePath, isLoading }) {
  return (
    <Form method="get" style={{ marginBottom: "16px" }}>
      <input type="hidden" name="page" value="1" />
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={LABEL}>Gruppen-SKU</label>
          <input
            type="text"
            name="sku"
            placeholder="z.B. BXAAA"
            defaultValue={filters.groupSku}
            style={{ ...INPUT, width: "140px" }}
          />
        </div>
        <div>
          <label style={LABEL}>Status</label>
          <select name="status" defaultValue={filters.status} style={{ ...INPUT, width: "130px" }}>
            <option value="all">Alle</option>
            <option value="success">Erfolgreich</option>
            <option value="error">Fehler</option>
          </select>
        </div>
        <div>
          <label style={LABEL}>Von</label>
          <input type="date" name="since" defaultValue={filters.since} style={INPUT} />
        </div>
        <div>
          <label style={LABEL}>Bis</label>
          <input type="date" name="until" defaultValue={filters.until} style={INPUT} />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="submit" style={BTN_PRIMARY}>{isLoading ? "Lädt…" : "Filtern"}</button>
          <Link to={basePath} style={BTN_SECONDARY}>Zurücksetzen</Link>
        </div>
      </div>
    </Form>
  );
}

/** Paginierung */
export function Pagination({ page, totalPages, total, filters, basePath }) {
  const btnOff = { ...BTN_SECONDARY, opacity: 0.4, pointerEvents: "none" };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
      <span style={{ fontSize: "13px", color: "#6d7175" }}>
        Seite {page} von {totalPages} · {total} Einträge
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        {page > 1
          ? <Link to={pageUrl(basePath, filters, page - 1)} style={BTN_SECONDARY}>← Zurück</Link>
          : <span style={btnOff}>← Zurück</span>}
        {page < totalPages
          ? <Link to={pageUrl(basePath, filters, page + 1)} style={BTN_SECONDARY}>Weiter →</Link>
          : <span style={btnOff}>Weiter →</span>}
      </div>
    </div>
  );
}

/** ID-Link zur Detailseite */
export function IdLink({ id }) {
  return (
    <Link
      to={`/app/logs/${id}`}
      style={{ fontFamily: "monospace", color: "#2c6ecb", fontSize: "12px", textDecoration: "none" }}
    >
      {id.substring(0, 8)}
    </Link>
  );
}

/** Status-Badge */
export function StatusBadge({ success }) {
  return success
    ? <span style={{ color: "#008060", fontWeight: 600 }}>✓ OK</span>
    : <span style={{ color: "#d82c0d", fontWeight: 600 }}>✗ Fehler</span>;
}

/** Tabellen-Wrapper */
export function TableWrap({ children }) {
  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        {children}
      </table>
    </div>
  );
}
