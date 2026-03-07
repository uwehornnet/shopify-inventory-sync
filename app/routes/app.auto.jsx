import { Form, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "~/db.server";
import {
  formatDate, formatDuration, formatTrigger, pageUrl,
  TH, TD, LABEL, INPUT, BTN_PRIMARY, BTN_SECONDARY,
  StatBar, LogFilter, Pagination, IdLink, StatusBadge, TableWrap,
} from "~/lib/ui-helpers";

const PAGE_SIZE = 25;
const BASE_PATH = "/app/auto";
const TRIGGERS  = ["webhook:orders/create", "webhook:orders/paid", "webhook:orders/cancelled"];

// ── Loader ──────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url      = new URL(request.url);
  const page     = Math.max(1, parseInt(url.searchParams.get("page")   || "1"));
  const groupSku = url.searchParams.get("sku")    || "";
  const status   = url.searchParams.get("status") || "all";
  const since    = url.searchParams.get("since")  || "";
  const until    = url.searchParams.get("until")  || "";

  const where = { trigger: { in: TRIGGERS } };
  if (groupSku) where.groupSku = { contains: groupSku.toUpperCase() };
  if (status === "success") where.success = true;
  if (status === "error")   where.success = false;
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = new Date(since);
    if (until) {
      const d = new Date(until);
      d.setHours(23, 59, 59, 999);
      where.createdAt.lte = d;
    }
  }

  const offset = (page - 1) * PAGE_SIZE;
  const [logs, total, successCount] = await Promise.all([
    db.syncLog.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, skip: offset }),
    db.syncLog.count({ where }),
    db.syncLog.count({ where: { ...where, success: true } }),
  ]);

  return Response.json({
    logs: logs.map((log) => ({ ...log, errors: log.errors ? JSON.parse(log.errors) : [] })),
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

// ── Seite ────────────────────────────────────────────────────────

export default function AutoSync() {
  const { logs, total, page, totalPages, filters, stats } = useLoaderData();
  const nav       = useNavigation();
  const isLoading = nav.state !== "idle";

  return (
    <s-page heading="Auto-Sync">
      <s-section>

        <StatBar items={[
          { label: "Gesamt",      value: stats.total },
          { label: "Erfolgreich", value: stats.successCount, color: "#008060" },
          { label: "Fehler",      value: stats.failureCount, color: stats.failureCount > 0 ? "#d82c0d" : undefined },
          { label: "Erfolgsrate", value: `${stats.successRate}%` },
        ]} />

        <LogFilter filters={filters} basePath={BASE_PATH} isLoading={isLoading} />

        {logs.length === 0 ? (
          <p style={{ color: "#6d7175" }}>Keine Einträge für die gewählten Filter.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th style={TH}>ID</th>
                  <th style={TH}>Datum</th>
                  <th style={TH}>Gruppen-SKU</th>
                  <th style={TH}>Bestellung</th>
                  <th style={{ ...TH, textAlign: "right" }}>Menge</th>
                  <th style={{ ...TH, textAlign: "right" }}>Varianten</th>
                  <th style={{ ...TH, textAlign: "right" }}>Dauer</th>
                  <th style={{ ...TH, textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={TD}><IdLink id={log.id} /></td>
                    <td style={{ ...TD, color: "#6d7175", whiteSpace: "nowrap" }}>{formatDate(log.createdAt)}</td>
                    <td style={{ ...TD, fontWeight: 600 }}>{log.groupSku}</td>
                    <td style={{ ...TD, color: "#6d7175" }}>{formatTrigger(log.trigger, log.orderNumber)}</td>
                    <td style={{ ...TD, textAlign: "right" }}>{log.quantity ?? "—"}</td>
                    <td style={{ ...TD, textAlign: "right" }}>{log.siblingsUpdated}/{log.siblingsFound}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#6d7175" }}>{formatDuration(log.durationMs)}</td>
                    <td style={{ ...TD, textAlign: "center" }}><StatusBadge success={log.success} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            <Pagination page={page} totalPages={totalPages} total={total} filters={filters} basePath={BASE_PATH} />
          </>
        )}

      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
