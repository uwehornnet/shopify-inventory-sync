import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "~/db.server";
import { formatDate, formatTrigger, TH, TD, IdLink, StatusBadge, TableWrap } from "~/lib/ui-helpers";

// ── Loader ──────────────────────────────────────────────────────

const AUTO_WHERE   = { trigger: { startsWith: "webhook:" } };
const BULK_WHERE   = { trigger: "manual:bulk-set" };
const MANUAL_WHERE = { trigger: { in: ["manual", "manual:test"] } };

async function catStats(where) {
  const [total, success, last] = await Promise.all([
    db.syncLog.count({ where }),
    db.syncLog.count({ where: { ...where, success: true } }),
    db.syncLog.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { total, success, failures: total - success, lastRun: last?.createdAt ?? null };
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const [autoStats, bulkStats, manualStats, recentLogs] = await Promise.all([
    catStats(AUTO_WHERE),
    catStats(BULK_WHERE),
    catStats(MANUAL_WHERE),
    db.syncLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return Response.json({
    autoStats,
    bulkStats,
    manualStats,
    recentLogs: recentLogs.map((log) => ({
      ...log,
      errors: log.errors ? JSON.parse(log.errors) : [],
    })),
  });
};

// ── Komponenten ─────────────────────────────────────────────────

function Tile({ title, href, stats }) {
  const rate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : null;
  const rateColor = rate === null ? "#8c9196" : rate >= 90 ? "#008060" : rate >= 70 ? "#b98900" : "#d82c0d";

  return (
    <div
      style={{
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        padding: "20px",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "15px", color: "#202223" }}>{title}</div>

      <div style={{ fontSize: "13px", color: "#6d7175" }}>
        Letzter Sync:{" "}
        <span style={{ color: "#202223", fontWeight: 500 }}>
          {stats.lastRun ? formatDate(stats.lastRun) : "Noch kein Eintrag"}
        </span>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        <div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#202223", lineHeight: 1 }}>{stats.total}</div>
          <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>Gesamt</div>
        </div>
        <div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#008060", lineHeight: 1 }}>{stats.success}</div>
          <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>Erfolgreich</div>
        </div>
        {stats.failures > 0 && (
          <div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: "#d82c0d", lineHeight: 1 }}>{stats.failures}</div>
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>Fehler</div>
          </div>
        )}
        {rate !== null && (
          <div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: rateColor, lineHeight: 1 }}>{rate}%</div>
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>Rate</div>
          </div>
        )}
      </div>

      <Link to={href} style={{ color: "#2c6ecb", fontSize: "13px", textDecoration: "none", fontWeight: 500 }}>
        Details anzeigen →
      </Link>
    </div>
  );
}

// ── Seite ────────────────────────────────────────────────────────

export default function Dashboard() {
  const { autoStats, bulkStats, manualStats, recentLogs } = useLoaderData();

  return (
    <s-page heading="Inventory Sync">
      <s-section>

        {/* Kacheln */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            marginBottom: "36px",
          }}
        >
          <Tile title="Auto-Sync" href="/app/auto" stats={autoStats} />
          <Tile title="Bestand setzen" href="/app/bulk" stats={bulkStats} />
          <Tile title="Manueller Sync" href="/app/manual" stats={manualStats} />
        </div>

        {/* Letzte Aktivitäten */}
        <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "12px", color: "#202223" }}>
          Letzte Aktivitäten
        </div>

        {recentLogs.length === 0 ? (
          <p style={{ color: "#6d7175", fontSize: "14px" }}>
            Noch keine Sync-Aktivitäten vorhanden. Syncs werden automatisch bei neuen Bestellungen ausgelöst.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th style={TH}>ID</th>
                <th style={TH}>Datum</th>
                <th style={TH}>Gruppen-SKU</th>
                <th style={TH}>Typ</th>
                <th style={{ ...TH, textAlign: "right" }}>Menge</th>
                <th style={{ ...TH, textAlign: "right" }}>Varianten</th>
                <th style={{ ...TH, textAlign: "center" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log) => (
                <tr key={log.id}>
                  <td style={TD}><IdLink id={log.id} /></td>
                  <td style={{ ...TD, color: "#6d7175", whiteSpace: "nowrap" }}>{formatDate(log.createdAt)}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{log.groupSku}</td>
                  <td style={{ ...TD, color: "#6d7175" }}>{formatTrigger(log.trigger, log.orderNumber)}</td>
                  <td style={{ ...TD, textAlign: "right" }}>{log.quantity ?? "—"}</td>
                  <td style={{ ...TD, textAlign: "right" }}>{log.siblingsUpdated}/{log.siblingsFound}</td>
                  <td style={{ ...TD, textAlign: "center" }}><StatusBadge success={log.success} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}

      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
