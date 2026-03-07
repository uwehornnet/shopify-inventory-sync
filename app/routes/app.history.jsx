import { useLoaderData, Form, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "~/db.server";

const PAGE_SIZE = 25;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const page    = Math.max(1, parseInt(url.searchParams.get("page")   || "1"));
  const groupSku = url.searchParams.get("sku")    || "";
  const status   = url.searchParams.get("status") || "all";
  const since    = url.searchParams.get("since")  || "";
  const until    = url.searchParams.get("until")  || "";

  const where = {};
  if (groupSku) where.groupSku = { contains: groupSku.toUpperCase() };
  if (status === "success") where.success = true;
  if (status === "error")   where.success = false;
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = new Date(since);
    if (until) {
      const untilDate = new Date(until);
      untilDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = untilDate;
    }
  }

  const offset = (page - 1) * PAGE_SIZE;

  const [logs, total, successCount] = await Promise.all([
    db.syncLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: offset,
    }),
    db.syncLog.count({ where }),
    db.syncLog.count({ where: { ...where, success: true } }),
  ]);

  return Response.json({
    logs: logs.map((log) => ({
      ...log,
      errors: log.errors ? JSON.parse(log.errors) : [],
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    filters: { groupSku, status, since, until },
    stats: {
      total,
      successCount,
      failureCount: total - successCount,
      successRate: total > 0 ? Math.round((successCount / total) * 100) : 0,
    },
  });
};

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  );
}

function formatDuration(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTrigger(trigger, orderNumber) {
  if (trigger === "manual") return "Manuell";
  if (trigger.includes("orders/create")) return orderNumber ? `Order #${orderNumber}` : "Order erstellt";
  if (trigger.includes("orders/paid"))   return orderNumber ? `Order #${orderNumber} (bezahlt)` : "Order bezahlt";
  return trigger;
}

function pageUrl(filters, page) {
  const p = new URLSearchParams();
  if (filters.groupSku) p.set("sku",    filters.groupSku);
  if (filters.status !== "all") p.set("status", filters.status);
  if (filters.since)   p.set("since",  filters.since);
  if (filters.until)   p.set("until",  filters.until);
  p.set("page", String(page));
  return `?${p.toString()}`;
}

export default function History() {
  const { logs, total, page, totalPages, filters, stats } = useLoaderData();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const inputStyle = {
    padding: "7px 10px",
    border: "1px solid #c9cccf",
    borderRadius: "6px",
    fontSize: "14px",
    fontFamily: "inherit",
    background: "#fff",
  };

  const btnStyle = (active) => ({
    padding: "7px 14px",
    border: "1px solid #c9cccf",
    borderRadius: "6px",
    fontSize: "14px",
    cursor: active ? "pointer" : "default",
    background: active ? "#fff" : "#f6f6f7",
    color: active ? "#202223" : "#8c9196",
    fontFamily: "inherit",
  });

  return (
    <s-page heading="Sync-History">

      {/* ── Stats ─────────────────────────────────────────────── */}
      <s-section heading="Ergebnisse">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Gefilterte Einträge</s-text>
              <s-heading>{total}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Erfolgreich</s-text>
              <s-heading>
                <span style={{ color: "#008060" }}>{stats.successCount}</span>
              </s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Fehler</s-text>
              <s-heading>
                <span style={{ color: stats.failureCount > 0 ? "#d82c0d" : "#202223" }}>
                  {stats.failureCount}
                </span>
              </s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Erfolgsrate</s-text>
              <s-heading>
                <span style={{ color: stats.successRate >= 90 ? "#008060" : stats.successRate >= 70 ? "#b98900" : "#d82c0d" }}>
                  {stats.successRate}%
                </span>
              </s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* ── Filter ────────────────────────────────────────────── */}
      <s-section heading="Filter">
        <Form method="get">
          <input type="hidden" name="page" value="1" />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                Gruppen-SKU
              </label>
              <input
                type="text"
                name="sku"
                placeholder="z.B. BXAAA"
                defaultValue={filters.groupSku}
                style={{ ...inputStyle, width: "140px" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                Status
              </label>
              <select
                name="status"
                defaultValue={filters.status}
                style={{ ...inputStyle, width: "140px" }}
              >
                <option value="all">Alle</option>
                <option value="success">Erfolgreich</option>
                <option value="error">Fehler</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                Von
              </label>
              <input
                type="date"
                name="since"
                defaultValue={filters.since}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                Bis
              </label>
              <input
                type="date"
                name="until"
                defaultValue={filters.until}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="submit"
                style={{
                  ...inputStyle,
                  background: "#008060",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                {isLoading ? "Lädt…" : "Filtern"}
              </button>
              <a
                href="/app/history"
                style={{ ...inputStyle, textDecoration: "none", color: "#6d7175", display: "inline-block" }}
              >
                Zurücksetzen
              </a>
            </div>

          </div>
        </Form>
      </s-section>

      {/* ── Table ─────────────────────────────────────────────── */}
      <s-section>
        {logs.length === 0 ? (
          <s-paragraph>Keine Einträge für die gewählten Filter.</s-paragraph>
        ) : (
          <>
            <s-box borderWidth="base" borderRadius="base" padding="none">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: "#f6f6f7", borderBottom: "1px solid #e1e3e5" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Datum</th>
                    <th style={{ padding: "10px 14px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Gruppen-SKU</th>
                    <th style={{ padding: "10px 14px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Quell-SKU</th>
                    <th style={{ padding: "10px 14px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Trigger</th>
                    <th style={{ padding: "10px 14px", textAlign: "right",  color: "#6d7175", fontWeight: 600 }}>Menge</th>
                    <th style={{ padding: "10px 14px", textAlign: "right",  color: "#6d7175", fontWeight: 600 }}>Varianten</th>
                    <th style={{ padding: "10px 14px", textAlign: "right",  color: "#6d7175", fontWeight: 600 }}>Dauer</th>
                    <th style={{ padding: "10px 14px", textAlign: "center", color: "#6d7175", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: i < logs.length - 1 ? "1px solid #f1f2f3" : "none",
                        background: log.success ? "transparent" : "#fff4f4",
                      }}
                    >
                      <td style={{ padding: "10px 14px", color: "#6d7175", whiteSpace: "nowrap" }}>
                        {formatDate(log.createdAt)}
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>{log.groupSku}</td>
                      <td style={{ padding: "10px 14px", color: "#6d7175" }}>{log.sourceVariantSku}</td>
                      <td style={{ padding: "10px 14px", color: "#6d7175" }}>
                        {formatTrigger(log.trigger, log.orderNumber)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        {log.quantity ?? "—"}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        {log.siblingsUpdated}/{log.siblingsFound}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#6d7175" }}>
                        {formatDuration(log.durationMs)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        {log.success ? (
                          <span style={{ color: "#008060", fontWeight: 600 }}>✓ OK</span>
                        ) : (
                          <span
                            style={{ color: "#d82c0d", fontWeight: 600, cursor: "help" }}
                            title={log.errors?.join("\n") || "Unbekannter Fehler"}
                          >
                            ✗ Fehler
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-box>

            {/* ── Pagination ──────────────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
              <span style={{ fontSize: "13px", color: "#6d7175" }}>
                Seite {page} von {totalPages} · {total} Einträge gesamt
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <a
                  href={page > 1 ? pageUrl(filters, page - 1) : undefined}
                  style={btnStyle(page > 1)}
                >
                  ← Zurück
                </a>
                <a
                  href={page < totalPages ? pageUrl(filters, page + 1) : undefined}
                  style={btnStyle(page < totalPages)}
                >
                  Weiter →
                </a>
              </div>
            </div>
          </>
        )}
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
