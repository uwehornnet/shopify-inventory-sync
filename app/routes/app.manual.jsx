import { useState, useRef } from "react";
import { useLoaderData, useFetcher, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "~/db.server";
import {
  formatDate, formatDuration, pageUrl,
  TH, TD, LABEL, INPUT, BTN_PRIMARY,
  StatBar, LogFilter, Pagination, IdLink, StatusBadge, TableWrap,
} from "~/lib/ui-helpers";

const PAGE_SIZE = 25;
const BASE_PATH = "/app/manual";

// ── Loader ──────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url      = new URL(request.url);
  const page     = Math.max(1, parseInt(url.searchParams.get("page")   || "1"));
  const groupSku = url.searchParams.get("sku")    || "";
  const status   = url.searchParams.get("status") || "all";
  const since    = url.searchParams.get("since")  || "";
  const until    = url.searchParams.get("until")  || "";

  const where = { trigger: { in: ["manual", "manual:test"] } };
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
    stats: { total, successCount, failureCount: total - successCount },
  });
};

// ── Action ───────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData  = await request.formData();
  const sku       = formData.get("sku")?.toString().trim();

  if (!sku)
    return Response.json({ error: "Bitte eine Varianten-SKU eingeben." }, { status: 400 });

  const { syncInventoryBySkuWithLogging } = await import("~/lib/sync-engine-with-logging");
  const result = await syncInventoryBySkuWithLogging(admin, sku, { trigger: "manual:test" });
  return Response.json({ result });
};

// ── Seite ────────────────────────────────────────────────────────

export default function ManualSync() {
  const { logs, total, page, totalPages, filters, stats } = useLoaderData();
  const nav          = useNavigation();
  const fetcher      = useFetcher();
  const skuRef       = useRef();
  const [formError, setFormError] = useState(null);

  const isLoading    = nav.state !== "idle";
  const isSubmitting = fetcher.state !== "idle";

  const handleSubmit = () => {
    const sku = skuRef.current?.value?.trim();
    if (!sku) { setFormError("Bitte eine Varianten-SKU eingeben."); return; }
    setFormError(null);
    fetcher.submit({ sku }, { method: "POST" });
  };

  const result = fetcher.data?.result;

  return (
    <s-page heading="Manueller Test-Sync">
      <s-section>

        {/* Formular */}
        <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "20px", marginBottom: "28px", background: "#fff" }}>
          <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>Sync manuell auslösen</div>
          <p style={{ color: "#6d7175", fontSize: "13px", margin: "0 0 16px" }}>
            Liest den Bestand einer Variante aus und synchronisiert alle Geschwister-Varianten auf denselben Wert.
          </p>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={LABEL}>Varianten-SKU</label>
              <input ref={skuRef} type="text" placeholder="z.B. BXAAA-1" style={{ ...INPUT, width: "200px" }} />
              <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#6d7175" }}>Mit Suffix — z.B. „BXAAA-1"</p>
            </div>
            <button onClick={handleSubmit} style={BTN_PRIMARY} disabled={isSubmitting}>
              {isSubmitting ? "Sync läuft…" : "Sync ausführen"}
            </button>
          </div>

          {formError && (
            <p style={{ color: "#d82c0d", fontSize: "13px", margin: "8px 0 0" }}>{formError}</p>
          )}
          {fetcher.data?.error && !isSubmitting && (
            <p style={{ color: "#d82c0d", fontSize: "13px", margin: "8px 0 0" }}>{fetcher.data.error}</p>
          )}

          {result && !isSubmitting && (() => {
            const ok = result.errors?.length === 0;
            return (
              <div style={{
                marginTop: "12px", padding: "12px 16px", borderRadius: "6px",
                background: ok ? "#f0fdf4" : "#fff4f4",
                border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
              }}>
                <p style={{ fontWeight: 600, color: ok ? "#008060" : "#d82c0d", margin: "0 0 4px" }}>
                  {ok ? "✓ Erfolgreich" : "✗ Fehler"}
                </p>
                <p style={{ margin: "0 0 4px", fontSize: "13px" }}>
                  Gruppe <strong>{result.groupSku}</strong>:{" "}
                  {result.siblingsUpdated}/{result.siblingsFound} Varianten auf Menge{" "}
                  <strong>{result.quantity}</strong> gesetzt
                </p>
                {result.errors?.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: "16px", fontSize: "12px", color: "#d82c0d" }}>
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>

        {/* Statistiken */}
        <StatBar items={[
          { label: "Gesamt",      value: stats.total },
          { label: "Erfolgreich", value: stats.successCount, color: "#008060" },
          { label: "Fehler",      value: stats.failureCount, color: stats.failureCount > 0 ? "#d82c0d" : undefined },
        ]} />

        {/* Filter */}
        <LogFilter filters={filters} basePath={BASE_PATH} isLoading={isLoading} />

        {/* Tabelle */}
        {logs.length === 0 ? (
          <p style={{ color: "#6d7175" }}>Noch keine Einträge vorhanden.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th style={TH}>ID</th>
                  <th style={TH}>Datum</th>
                  <th style={TH}>Varianten-SKU</th>
                  <th style={TH}>Gruppen-SKU</th>
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
                    <td style={{ ...TD, color: "#6d7175" }}>{log.sourceVariantSku || "—"}</td>
                    <td style={{ ...TD, fontWeight: 600 }}>{log.groupSku}</td>
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
