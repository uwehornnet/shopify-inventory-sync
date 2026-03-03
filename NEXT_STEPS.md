# Phase 2: Webhook-Integration

**Status**: 🔄 Bereit zum Start
**Voraussetzung**: ✅ Phase 1 abgeschlossen
**Geschätzter Aufwand**: ~25.000 Tokens (~30 Minuten)

---

## 🎯 Ziel von Phase 2

Nach Phase 2 wird Ihre App:
- ✅ Webhooks von Shopify empfangen können
- ✅ Automatisch bei Bestellungen synchronisieren
- ✅ Einen Test-Endpoint für manuelles Debugging haben
- ✅ Webhook-Signaturen verifizieren (Sicherheit!)

---

## 📋 Aufgaben-Checkliste

### 1. Webhook-Route: `orders/create` (Primary Trigger)
- [ ] Datei erstellen: `app/routes/webhooks.orders-create.jsx`
- [ ] Request-Body als Raw-String lesen
- [ ] HMAC-Signatur verifizieren
- [ ] Order-Daten parsen
- [ ] Line-Items extrahieren
- [ ] Pro Gruppe: `syncInventoryForVariant()` aufrufen
- [ ] Response mit Status-Code 200 zurückgeben

### 2. Webhook-Route: `orders/paid` (Backup Trigger)
- [ ] Datei erstellen: `app/routes/webhooks.orders-paid.jsx`
- [ ] Identische Logik wie `orders/create`
- [ ] Dient als Sicherheitsnetz für verpasste Syncs

### 3. Test-Endpoint: Manueller Sync
- [ ] Datei erstellen: `app/routes/api.test-sync.jsx`
- [ ] Query-Parameter `?sku=BXAAA-1` akzeptieren
- [ ] Sync-Engine direkt aufrufen
- [ ] JSON-Response mit Sync-Ergebnis

### 4. Webhook-Registrierung
- [ ] `shopify.app.toml` erweitern
- [ ] `orders/create` Topic registrieren
- [ ] `orders/paid` Topic registrieren
- [ ] Scopes aktualisieren (`read_orders`, `write_inventory`)

---

## 💻 Implementierungs-Details

### Datei 1: `app/routes/webhooks.orders-create.jsx`

**React Router Action Pattern**:
```javascript
import { json } from "react-router";
import { verifyShopifyWebhook } from "~/lib/webhook-verify";
import { syncInventoryForVariant } from "~/lib/sync-engine";
import { extractGroupSku } from "~/lib/sku";

export async function action({ request }) {
  // 1. Raw Body lesen (wichtig für HMAC!)
  const rawBody = await request.text();

  // 2. HMAC verifizieren
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!verifyShopifyWebhook(rawBody, hmacHeader, secret)) {
    return json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  // 3. Order parsen
  const order = JSON.parse(rawBody);

  // 4. Line Items extrahieren & deduplizieren
  const uniqueGroups = new Map();

  for (const item of order.line_items) {
    const sku = item.sku;
    const groupSku = extractGroupSku(sku);

    if (groupSku && !uniqueGroups.has(groupSku)) {
      uniqueGroups.set(groupSku, {
        sku: sku,
        inventoryItemId: `gid://shopify/InventoryItem/${item.inventory_item_id}`
      });
    }
  }

  // 5. Sync für jede Gruppe
  const results = [];

  for (const [groupSku, { sku, inventoryItemId }] of uniqueGroups) {
    try {
      const result = await syncInventoryForVariant(sku, inventoryItemId);
      results.push(result);
    } catch (error) {
      console.error(`Sync failed for ${groupSku}:`, error);
      results.push({ groupSku, error: error.message });
    }
  }

  console.log(`[Webhook] orders/create processed: ${results.length} syncs`);

  return json({ success: true, syncs: results.length }, { status: 200 });
}
```

**Wichtige Details**:
- `request.text()` statt `request.json()` für HMAC-Verifizierung
- `Map()` für Deduplizierung (keine doppelten Syncs pro Gruppe)
- `gid://shopify/InventoryItem/${id}` - Shopify Global ID Format
- Error-Handling pro Gruppe (ein Fehler stoppt nicht alle Syncs)

---

### Datei 2: `app/routes/webhooks.orders-paid.jsx`

**Identisch zu `orders-create.jsx`**, nur Log-Prefix ändern:
```javascript
console.log(`[Webhook] orders/paid processed: ${results.length} syncs`);
```

**Zweck**: Backup-Trigger falls `orders/create` fehlschlägt.

---

### Datei 3: `app/routes/api.test-sync.jsx`

**Test-Endpoint für manuelles Debugging**:
```javascript
import { json } from "react-router";
import { syncInventoryForVariant } from "~/lib/sync-engine";

export async function loader({ request }) {
  const url = new URL(request.url);
  const sku = url.searchParams.get("sku");
  const inventoryItemId = url.searchParams.get("inventoryItemId");

  if (!sku || !inventoryItemId) {
    return json({
      error: "Missing parameters",
      usage: "/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123"
    }, { status: 400 });
  }

  try {
    const result = await syncInventoryForVariant(sku, inventoryItemId);
    return json({ success: true, result }, { status: 200 });
  } catch (error) {
    return json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
```

**Aufruf-Beispiel**:
```bash
curl "http://localhost:3000/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123456789"
```

---

### Datei 4: `shopify.app.toml` Update

**Aktuellen Inhalt erweitern**:
```toml
# Bestehende App-Config bleibt unverändert
# ...

# Scopes erweitern
scopes = "write_products,read_inventory,write_inventory,read_orders"

# Webhooks hinzufügen
[[webhooks.subscriptions]]
topics = ["orders/create"]
uri = "/webhooks/orders-create"

[[webhooks.subscriptions]]
topics = ["orders/paid"]
uri = "/webhooks/orders-paid"
```

**Wichtig**:
- `uri` ist relativ zur `application_url`
- Nach Änderung: `shopify app deploy` ausführen
- Shopify registriert Webhooks automatisch

---

## 🧪 Testing-Workflow

### Lokales Testen (mit Shopify CLI)

**1. Lokale Umgebung starten**:
```bash
cd schaltauge-shopifyapp
cp .env.example .env
# .env mit echten Credentials füllen!

shopify app dev
```

**2. Test-Endpoint testen**:
```bash
# Öffne die von Shopify CLI angezeigte URL (z.B. https://abc123.ngrok.io)
curl "https://abc123.ngrok.io/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123"
```

**3. Webhook testen (via Shopify Admin)**:
- Shopify Admin > Settings > Notifications > Webhooks
- Manuell Event senden: "Send test notification"
- Logs prüfen in Terminal (Shopify CLI zeigt Logs)

**4. Echte Bestellung testen**:
- Im Shopify Test-Store eine Bestellung aufgeben
- Webhook wird automatisch gefeuert
- Logs in Terminal beobachten

---

## 🔍 Debugging-Tipps

### Webhook kommt nicht an?
1. Shopify CLI Log prüfen: Zeigt eingehende Requests
2. Webhook-Status prüfen: Shopify Admin > Settings > Notifications
3. HMAC-Fehler? → `.env` Webhook-Secret prüfen

### Sync schlägt fehl?
1. `console.log()` in `sync-engine.js` hinzufügen
2. GraphQL-Errors prüfen (werden geloggt)
3. SKU-Format prüfen: `extractGroupSku()` testen

### Rate-Limiting?
1. Delay in `sync-engine.js` erhöhen (200ms → 500ms)
2. Shopify Admin > API-Limits prüfen
3. Retry-Logik ist bereits implementiert

---

## 📊 Erwartete Ergebnisse nach Phase 2

### Funktionsfähigkeit
- ✅ Bestellung in Shopify aufgeben → Webhook wird empfangen
- ✅ Webhook-Signatur wird verifiziert
- ✅ Sync-Engine wird aufgerufen
- ✅ Geschwister-Varianten werden aktualisiert

### Logs-Beispiel (erfolgreich)
```
[Webhook] orders/create received
[Sync] Starting sync for group BXAAA (triggered by BXAAA-1)
[Sync] BXAAA: current quantity = 47 at gid://shopify/Location/123
[Sync] BXAAA: found 3 siblings
[Sync] BXAAA: updated 2/2 siblings to quantity 47
[Webhook] orders/create processed: 1 syncs
```

### Nicht implementiert (kommt später)
- ❌ UI-Dashboard (Phase 4)
- ❌ Datenbank-Logging (Phase 3)
- ❌ Produktions-Deployment (Phase 5)

---

## 🚀 Schnellstart-Kommando

**Wenn Sie Phase 2 starten möchten, sagen Sie einfach**:

> "Starte Phase 2 laut NEXT_STEPS.md"

Oder wenn Sie nur einzelne Dateien erstellen möchten:
> "Erstelle webhooks.orders-create.jsx aus NEXT_STEPS.md"

---

## 📝 Checklist vor Phase 2

- [ ] `.env` Datei erstellt und ausgefüllt
- [ ] `SHOPIFY_STORE_DOMAIN` gesetzt
- [ ] `SHOPIFY_ACCESS_TOKEN` gesetzt (Admin API Token)
- [ ] `SHOPIFY_WEBHOOK_SECRET` gesetzt
- [ ] `SHOPIFY_API_VERSION` gesetzt (z.B. `2024-10`)

---

## 🔗 Nützliche Links

### Shopify Dokumentation
- [Webhooks Guide](https://shopify.dev/docs/apps/build/webhooks)
- [HMAC Verification](https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-5-verify-the-webhook)
- [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql)
- [Inventory API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities)

### React Router Dokumentation
- [Actions & Loaders](https://reactrouter.com/start/framework/actions-and-loaders)
- [Request Handling](https://reactrouter.com/start/framework/request-handling)

---

## 💡 Hinweise zu Phase 3-5

### Phase 3: Datenbank & Logging
- Prisma Schema erweitern mit `SyncLog` Tabelle
- Jeden Sync speichern (Timestamp, SKU, Erfolg/Fehler)
- Audit-Trail für Troubleshooting

### Phase 4: UI-Dashboard
- Sync-Historie in Polaris-Tabelle anzeigen
- Button für manuellen Sync
- Status-Badges (✅ Erfolg, ❌ Fehler)

### Phase 5: Testing & Deployment
- Unit-Tests für `sku.js`, `sync-engine.js`
- Integration-Tests für Webhooks
- Deployment auf Fly.io oder Shopify
- Produktions-Monitoring einrichten

---

**Letzte Aktualisierung**: 13. Februar 2026, 14:35 UTC
**Bereit für**: Phase 2 Start
**Geschätzter Zeitaufwand**: 30-45 Minuten
