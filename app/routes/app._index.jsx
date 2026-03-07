import { useState, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "~/db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const [recentLogs, totalCount, successCount] = await Promise.all([
    db.syncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.syncLog.count(),
    db.syncLog.count({ where: { success: true } }),
  ]);

  return Response.json({
    recentLogs: recentLogs.map((log) => ({
      ...log,
      errors: log.errors ? JSON.parse(log.errors) : [],
    })),
    stats: {
      totalCount,
      successCount,
      failureCount: totalCount - successCount,
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0,
      lastSync: recentLogs[0]?.createdAt ?? null,
    },
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const type = formData.get("_type");

  // ── Bestand setzen (Bulk Set) ───────────────────────────────
  if (type === "setAll") {
    const groupSku  = formData.get("groupSku")?.toString().trim().toUpperCase();
    const quantityRaw = formData.get("quantity")?.toString().trim();
    const quantity  = parseInt(quantityRaw);

    if (!groupSku) {
      return Response.json({ setAllError: "Bitte eine Gruppen-SKU eingeben." }, { status: 400 });
    }
    if (isNaN(quantity) || quantity < 0) {
      return Response.json({ setAllError: "Bitte eine gültige Menge (≥ 0) eingeben." }, { status: 400 });
    }

    const { setInventoryForGroup } = await import("~/lib/sync-engine");
    const result = await setInventoryForGroup(admin, groupSku, quantity);
    return Response.json({ setAllResult: result });
  }

  // ── Manueller Sync ─────────────────────────────────────────
  const sku = formData.get("sku")?.toString().trim();

  if (!sku) {
    return Response.json({ syncError: "Bitte eine Varianten-SKU eingeben." }, { status: 400 });
  }

  const { syncInventoryBySku } = await import("~/lib/sync-engine");
  const result = await syncInventoryBySku(admin, sku);
  return Response.json({ syncResult: result });
};

// ── Helpers ────────────────────────────────────────────────────

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

function formatTrigger(trigger) {
  return trigger.replace("webhook:orders/", "Order ").replace("webhook:", "");
}

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "14px",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle = {
  display: "block",
  marginBottom: "4px",
  fontSize: "14px",
  fontWeight: 500,
  color: "#202223",
};

// ── Component ──────────────────────────────────────────────────

export default function Index() {
  const { recentLogs, stats } = useLoaderData();

  // Fetcher: Manueller Sync
  const syncFetcher   = useFetcher();
  const skuRef        = useRef();
  const [syncFormError, setSyncFormError] = useState(null);

  // Fetcher: Bestand setzen
  const setAllFetcher  = useFetcher();
  const groupSkuRef    = useRef();
  const quantityRef    = useRef();
  const [setAllFormError, setSetAllFormError] = useState(null);

  const isSyncing  = syncFetcher.state !== "idle";
  const isSettingAll = setAllFetcher.state !== "idle";

  const handleSync = () => {
    const sku = skuRef.current?.value?.trim();
    if (!sku) { setSyncFormError("Bitte eine Varianten-SKU eingeben."); return; }
    setSyncFormError(null);
    syncFetcher.submit({ _type: "sync", sku }, { method: "POST" });
  };

  const handleSetAll = () => {
    const groupSku = groupSkuRef.current?.value?.trim();
    const quantity = quantityRef.current?.value?.trim();
    if (!groupSku || quantity === "") { setSetAllFormError("Bitte beide Felder ausfüllen."); return; }
    if (isNaN(parseInt(quantity)) || parseInt(quantity) < 0) {
      setSetAllFormError("Menge muss eine Zahl ≥ 0 sein.");
      return;
    }
    setSetAllFormError(null);
    setAllFetcher.submit({ _type: "setAll", groupSku, quantity }, { method: "POST" });
  };

  return (
    <s-page heading="Inventory Sync">

      {/* ── Stats ─────────────────────────────────────────────── */}
      <s-section heading="Übersicht">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Gesamt Syncs</s-text>
              <s-heading>{stats.totalCount}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Erfolgreich</s-text>
              <s-heading><span style={{ color: "#008060" }}>{stats.successCount}</span></s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Fehler</s-text>
              <s-heading>
                <span style={{ color: stats.failureCount > 0 ? "#d82c0d" : "#202223" }}>{stats.failureCount}</span>
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
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>Letzter Sync</s-text>
              <s-paragraph><span style={{ fontSize: "13px" }}>{formatDate(stats.lastSync)}</span></s-paragraph>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* ── Recent Logs ───────────────────────────────────────── */}
      <s-section heading="Letzte Aktivitäten">
        {recentLogs.length === 0 ? (
          <s-paragraph>Noch keine Sync-Aktivitäten vorhanden. Syncs werden automatisch bei neuen Bestellungen ausgelöst.</s-paragraph>
        ) : (
          <s-box borderWidth="base" borderRadius="base" padding="none">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#f6f6f7", borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Datum</th>
                  <th style={{ padding: "10px 16px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Gruppen-SKU</th>
                  <th style={{ padding: "10px 16px", textAlign: "left",   color: "#6d7175", fontWeight: 600 }}>Trigger</th>
                  <th style={{ padding: "10px 16px", textAlign: "right",  color: "#6d7175", fontWeight: 600 }}>Menge</th>
                  <th style={{ padding: "10px 16px", textAlign: "right",  color: "#6d7175", fontWeight: 600 }}>Varianten</th>
                  <th style={{ padding: "10px 16px", textAlign: "right",  color: "#6d7175", fontWeight: 600 }}>Dauer</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", color: "#6d7175", fontWeight: 600 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log, i) => (
                  <tr key={log.id} style={{
                    borderBottom: i < recentLogs.length - 1 ? "1px solid #f1f2f3" : "none",
                    background: log.success ? "transparent" : "#fff4f4",
                  }}>
                    <td style={{ padding: "10px 16px", color: "#6d7175", whiteSpace: "nowrap" }}>{formatDate(log.createdAt)}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 600 }}>{log.groupSku}</td>
                    <td style={{ padding: "10px 16px", color: "#6d7175" }}>{formatTrigger(log.trigger)}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>{log.quantity ?? "—"}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>{log.siblingsUpdated}/{log.siblingsFound}</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", color: "#6d7175" }}>{formatDuration(log.durationMs)}</td>
                    <td style={{ padding: "10px 16px", textAlign: "center" }}>
                      {log.success
                        ? <span style={{ color: "#008060", fontWeight: 600 }}>✓ OK</span>
                        : <span style={{ color: "#d82c0d", fontWeight: 600, cursor: "help" }} title={log.errors?.join("\n")}>✗ Fehler</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-box>
        )}
        {recentLogs.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <s-link href="/app/history">Alle Sync-Logs anzeigen →</s-link>
          </div>
        )}
      </s-section>

      {/* ── Sidebar: Bestand setzen ───────────────────────────── */}
      <s-section slot="aside" heading="Bestand setzen">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Setzt <strong>alle Varianten</strong> einer Gruppen-SKU auf eine feste Menge — ideal zum Initialisieren des Bestands vor Shop-Start.
          </s-paragraph>

          <div>
            <label style={labelStyle}>Gruppen-SKU</label>
            <input
              ref={groupSkuRef}
              type="text"
              placeholder="z.B. BXAAA"
              style={inputStyle}
            />
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6d7175" }}>
              Nur der Gruppen-Teil — ohne Suffix (z.B. ohne „-1")
            </p>
          </div>

          <div>
            <label style={labelStyle}>Ziel-Menge</label>
            <input
              ref={quantityRef}
              type="number"
              min="0"
              placeholder="z.B. 50"
              style={inputStyle}
            />
          </div>

          {setAllFormError && (
            <p style={{ color: "#d82c0d", fontSize: "13px", margin: 0 }}>{setAllFormError}</p>
          )}
          {setAllFetcher.data?.setAllError && (
            <p style={{ color: "#d82c0d", fontSize: "13px", margin: 0 }}>{setAllFetcher.data.setAllError}</p>
          )}

          <s-button onClick={handleSetAll} {...(isSettingAll ? { loading: true } : {})}>
            {isSettingAll ? "Wird gesetzt…" : "Bestand setzen"}
          </s-button>

          {setAllFetcher.data?.setAllResult && !isSettingAll && (() => {
            const r = setAllFetcher.data.setAllResult;
            const ok = r.errors?.length === 0;
            return (
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="tight">
                  <s-paragraph>
                    <span style={{ color: ok ? "#008060" : "#d82c0d", fontWeight: 600 }}>
                      {ok ? "✓ Erfolgreich" : "⚠ Teilweise Fehler"}
                    </span>
                  </s-paragraph>
                  <s-paragraph>
                    Gruppe: <strong>{r.groupSku}</strong>
                  </s-paragraph>
                  <s-paragraph>
                    <strong>{r.variantsUpdated}</strong> von <strong>{r.variantsFound}</strong> Varianten auf Menge <strong>{r.quantity}</strong> gesetzt
                  </s-paragraph>
                  {r.errors?.length > 0 && (
                    <s-paragraph>
                      <span style={{ color: "#d82c0d", fontSize: "13px" }}>
                        Fehler: {r.errors.join(", ")}
                      </span>
                    </s-paragraph>
                  )}
                </s-stack>
              </s-box>
            );
          })()}
        </s-stack>
      </s-section>

      {/* ── Sidebar: Manueller Sync ───────────────────────────── */}
      <s-section slot="aside" heading="Manueller Test-Sync">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Liest den Bestand einer Variante aus und synchronisiert alle Geschwister auf denselben Wert.
          </s-paragraph>

          <div>
            <label style={labelStyle}>Varianten-SKU</label>
            <input ref={skuRef} type="text" placeholder="z.B. BXAAA-1" style={inputStyle} />
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6d7175" }}>
              Mit Suffix — z.B. „BXAAA-1" für eine bestimmte Variante
            </p>
          </div>

          {syncFormError && (
            <p style={{ color: "#d82c0d", fontSize: "13px", margin: 0 }}>{syncFormError}</p>
          )}
          {syncFetcher.data?.syncError && (
            <p style={{ color: "#d82c0d", fontSize: "13px", margin: 0 }}>{syncFetcher.data.syncError}</p>
          )}

          <s-button onClick={handleSync} {...(isSyncing ? { loading: true } : {})}>
            {isSyncing ? "Sync läuft…" : "Sync ausführen"}
          </s-button>

          {syncFetcher.data?.syncResult && !isSyncing && (() => {
            const r = syncFetcher.data.syncResult;
            const ok = r.errors?.length === 0;
            return (
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="tight">
                  <s-paragraph>
                    <span style={{ color: ok ? "#008060" : "#d82c0d", fontWeight: 600 }}>
                      {ok ? "✓ Erfolgreich" : "✗ Fehler"}
                    </span>
                  </s-paragraph>
                  <s-paragraph>Gruppe: <strong>{r.groupSku}</strong></s-paragraph>
                  <s-paragraph>
                    {r.siblingsUpdated}/{r.siblingsFound} Varianten auf Menge <strong>{r.quantity}</strong> gesetzt
                  </s-paragraph>
                  {r.errors?.length > 0 && (
                    <s-paragraph>
                      <span style={{ color: "#d82c0d", fontSize: "13px" }}>{r.errors.join(", ")}</span>
                    </s-paragraph>
                  )}
                </s-stack>
              </s-box>
            );
          })()}
        </s-stack>
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
