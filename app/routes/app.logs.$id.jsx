import { useLoaderData, Form, Link, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "~/db.server";
import { formatDate, formatDuration, formatTrigger, BTN_DANGER, BTN_SECONDARY } from "~/lib/ui-helpers";

// ── Loader ──────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);

  const log = await db.syncLog.findUnique({ where: { id: params.id } });
  if (!log) throw new Response("Log-Eintrag nicht gefunden", { status: 404 });

  return Response.json({
    log: { ...log, errors: log.errors ? JSON.parse(log.errors) : [] },
  });
};

// ── Action (Löschen) ─────────────────────────────────────────────

export const action = async ({ request, params }) => {
  await authenticate.admin(request);

  if (request.method === "DELETE") {
    await db.syncLog.delete({ where: { id: params.id } });
    return redirect("/app");
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

// ── Hilfskomponenten ─────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{
        fontSize: "11px",
        color: "#6d7175",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        marginBottom: "5px",
      }}>
        {label}
      </div>
      <div style={{ fontSize: "14px", color: "#202223" }}>
        {children ?? <span style={{ color: "#c9cccf" }}>—</span>}
      </div>
    </div>
  );
}

// ── Seite ────────────────────────────────────────────────────────

export default function LogDetail() {
  const { log } = useLoaderData();

  // Zurück-Link je nach Kategorie
  const backUrl =
    (log.trigger || "").startsWith("webhook:") ? "/app/auto"
    : log.trigger === "manual:bulk-set"        ? "/app/bulk"
    : "/app/manual";

  const handleDelete = (e) => {
    if (!confirm("Diesen Eintrag wirklich aus der Datenbank löschen?\nDiese Aktion kann nicht rückgängig gemacht werden.")) {
      e.preventDefault();
    }
  };

  return (
    <s-page heading="Log-Detail">
      <s-section>

        {/* Zurück */}
        <Link
          to={backUrl}
          style={{ ...BTN_SECONDARY, display: "inline-block", marginBottom: "24px" }}
        >
          ← Zurück zur Liste
        </Link>

        {/* Status-Banner */}
        <div style={{
          padding: "14px 18px",
          borderRadius: "8px",
          marginBottom: "28px",
          background: log.success ? "#f0fdf4" : "#fff4f4",
          border: `1px solid ${log.success ? "#bbf7d0" : "#fecaca"}`,
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}>
          <span style={{ fontSize: "20px" }}>{log.success ? "✓" : "✗"}</span>
          <div>
            <span style={{ fontWeight: 700, fontSize: "15px", color: log.success ? "#008060" : "#d82c0d" }}>
              {log.success ? "Erfolgreich" : "Fehlgeschlagen"}
            </span>
            {log.siblingsUpdated != null && (
              <span style={{ color: "#6d7175", fontSize: "13px", marginLeft: "12px" }}>
                {log.siblingsUpdated} von {log.siblingsFound} Varianten synchronisiert
                {log.quantity != null && ` · Menge: ${log.quantity}`}
              </span>
            )}
          </div>
        </div>

        {/* Felder — 3 Spalten */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0 40px" }}>
          <Field label="ID">
            <span style={{ fontFamily: "monospace", fontSize: "13px", wordBreak: "break-all" }}>{log.id}</span>
          </Field>
          <Field label="Datum">{formatDate(log.createdAt)}</Field>
          <Field label="Trigger">{formatTrigger(log.trigger, log.orderNumber)}</Field>

          <Field label="Gruppen-SKU"><strong>{log.groupSku}</strong></Field>
          <Field label="Varianten-SKU">{log.sourceVariantSku}</Field>
          <Field label="InventoryItem-ID">
            {log.inventoryItemId
              ? <span style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>{log.inventoryItemId}</span>
              : null}
          </Field>

          <Field label="Menge">{log.quantity != null ? String(log.quantity) : null}</Field>
          <Field label="Varianten gefunden">{log.siblingsFound != null ? String(log.siblingsFound) : null}</Field>
          <Field label="Varianten aktualisiert">{log.siblingsUpdated != null ? String(log.siblingsUpdated) : null}</Field>

          <Field label="Dauer">{formatDuration(log.durationMs)}</Field>
          <Field label="Bestellungs-ID">{log.orderId}</Field>
          <Field label="Bestellungsnummer">{log.orderNumber ? `#${log.orderNumber}` : null}</Field>
        </div>

        {/* Fehlerlog */}
        {log.errors?.length > 0 && (
          <div style={{ marginTop: "8px", marginBottom: "24px" }}>
            <div style={{
              fontSize: "11px",
              color: "#6d7175",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              marginBottom: "8px",
            }}>
              Fehlerdetails
            </div>
            <textarea
              readOnly
              value={log.errors.join("\n\n")}
              rows={Math.min(12, log.errors.length * 3 + 2)}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: "12px",
                lineHeight: 1.6,
                padding: "12px",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                background: "#fff4f4",
                color: "#b91c1c",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Löschen */}
        <div style={{
          marginTop: "32px",
          paddingTop: "24px",
          borderTop: "1px solid #e1e3e5",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}>
          <Form method="delete" onSubmit={handleDelete}>
            <button type="submit" style={BTN_DANGER}>
              Eintrag löschen
            </button>
          </Form>
          <span style={{ fontSize: "12px", color: "#8c9196" }}>
            Löscht diesen Eintrag unwiderruflich aus der Datenbank.
          </span>
        </div>

      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
