# Testing Guide - Phase 2

**Status**: ✅ App ist funktionsfähig und bereit für Tests
**Version**: v0.2.0 (Phase 2 abgeschlossen)

---

## 🚀 Schnellstart (5 Minuten)

### 1. Environment konfigurieren

```bash
cd schaltauge-shopifyapp
cp .env.example .env
```

Öffne `.env` und fülle aus:
```bash
SHOPIFY_STORE_DOMAIN=schaltauge24.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-10
SHOPIFY_WEBHOOK_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
APP_URL=http://localhost:3000
```

**Wo finde ich diese Werte?**
- **Access Token**: Shopify Admin → Settings → Apps and sales channels → Develop apps
- **Webhook Secret**: Shopify Admin → Settings → Notifications → Webhooks (nach Registrierung)
- **Store Domain**: Ihre `*.myshopify.com` URL

### 2. Dependencies installieren

```bash
npm install
```

### 3. Datenbank initialisieren

```bash
npm run setup
```

### 4. App starten

```bash
npm run dev
```

**Ausgabe**:
```
┃ Preview your project at https://abc123.ngrok.io
┃ Your app is running on port 3000
```

✅ **App läuft!** Shopify CLI hat automatisch einen Tunnel erstellt.

---

## 🧪 Test 1: Manueller Sync (Test-Endpoint)

### Schritt 1: Test-SKU vorbereiten

Erstellen Sie in Ihrem Shopify-Store 3 Produktvarianten:
- `BXAAA-1` (z.B. Rot, Größe M)
- `BXAAA-2` (z.B. Blau, Größe M)
- `BXAAA-3` (z.B. Grün, Größe M)

**Wichtig**: Alle müssen denselben Basis-SKU haben (`BXAAA`).

### Schritt 2: Inventory Item ID finden

**Option A: GraphQL Admin API**:
```graphql
{
  productVariants(first: 1, query: "sku:BXAAA-1") {
    edges {
      node {
        sku
        inventoryItem {
          id
        }
      }
    }
  }
}
```

**Option B: Shopify Admin URL**:
1. Produkt öffnen
2. Variante bearbeiten
3. URL ansehen: `...variants/123456789` ← Das ist die Variant ID
4. Inventory Item ID ist meist identisch oder +1

### Schritt 3: Test-Request senden

```bash
curl "https://abc123.ngrok.io/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123456789"
```

### Erwartete Response

**Erfolg**:
```json
{
  "success": true,
  "result": {
    "groupSku": "BXAAA",
    "sourceVariantSku": "BXAAA-1",
    "quantity": 47,
    "siblingsFound": 3,
    "siblingsUpdated": 2,
    "errors": []
  }
}
```

**Terminal-Logs**:
```
[Test-Sync] Manual sync requested for SKU: BXAAA-1
[Sync] Starting sync for group BXAAA (triggered by BXAAA-1)
[Sync] BXAAA: current quantity = 47 at gid://shopify/Location/67890
[Sync] BXAAA: found 3 siblings
[Sync] BXAAA: updated 2/2 siblings to quantity 47
[Test-Sync] ✓ BXAAA: 2/3 variants synced to qty 47
```

### ✅ Test 1 bestanden wenn:
- Response hat `"success": true`
- `siblingsUpdated` > 0
- Keine Errors
- In Shopify Admin: Alle 3 Varianten haben jetzt denselben Bestand

---

## 🧪 Test 2: Webhook (Automatischer Sync)

### Schritt 1: Webhook registrieren

```bash
shopify app deploy
```

**Oder manuell**: Shopify Admin → Settings → Notifications → Webhooks
- Topic: `orders/create`
- URL: `https://abc123.ngrc.io/webhooks/orders-create`
- Format: JSON

### Schritt 2: Test-Bestellung erstellen

**Im Shopify Test-Store**:
1. Produkt mit SKU `BXAAA-1` in den Warenkorb legen
2. Checkout durchlaufen
3. Bestellung abschließen

### Schritt 3: Logs prüfen

**Terminal zeigt**:
```
[Webhook] orders/create received
[Webhook] Order #1001 - 1 items
[Webhook] Found 1 unique group(s) to sync
[Webhook] Syncing group BXAAA (from BXAAA-1)
[Sync] Starting sync for group BXAAA (triggered by BXAAA-1)
[Sync] BXAAA: current quantity = 46 at gid://shopify/Location/67890
[Sync] BXAAA: found 3 siblings
[Sync] BXAAA: updated 2/2 siblings to quantity 46
[Webhook] ✓ BXAAA: 2/3 variants synced to qty 46
[Webhook] orders/create completed: 1/1 syncs successful
```

### Schritt 4: Shopify Admin verifizieren

**Alle 3 Varianten** (`BXAAA-1`, `BXAAA-2`, `BXAAA-3`) haben jetzt:
- ✅ Denselben Bestand (z.B. 46)
- ✅ Inventory History zeigt "Correction" Event

### ✅ Test 2 bestanden wenn:
- Webhook wurde empfangen (Logs zeigen `[Webhook] orders/create received`)
- Sync wurde ausgeführt
- Alle Geschwister-Varianten haben denselben Bestand

---

## 🧪 Test 3: Error-Handling

### Test 3a: Ungültiger SKU-Format

```bash
curl "https://abc123.ngrok.io/api/test-sync?sku=INVALID&inventoryItemId=gid://shopify/InventoryItem/123"
```

**Erwartete Response**:
```json
{
  "success": false,
  "result": {
    "groupSku": "UNKNOWN",
    "errors": ["Invalid SKU format: \"INVALID\""]
  }
}
```

### Test 3b: Nicht existierende Inventory Item ID

```bash
curl "https://abc123.ngrok.io/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/999999999"
```

**Erwartete Response**:
```json
{
  "success": false,
  "result": {
    "errors": ["Could not read inventory for BXAAA-1"]
  }
}
```

### ✅ Test 3 bestanden wenn:
- Fehler werden korrekt erkannt
- Keine Crashes/500 Errors
- Hilfreiche Fehlermeldungen in Response

---

## 🧪 Test 4: Rate-Limiting

### Schritt 1: Viele Varianten erstellen

Erstellen Sie 10 Varianten:
- `BXAAA-1`, `BXAAA-2`, ..., `BXAAA-10`

### Schritt 2: Sync auslösen

```bash
curl "https://abc123.ngrok.io/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123"
```

### Schritt 3: Logs beobachten

**Bei Rate-Limiting**:
```
[Shopify] Rate limited, waiting 2s...
[Shopify] Throttled, waiting 2s...
```

**Nach Retry**:
```
[Sync] BXAAA: updated 9/10 variants synced to qty 47
```

### ✅ Test 4 bestanden wenn:
- Automatische Retries funktionieren
- Alle Varianten werden trotz Rate-Limiting synchronisiert
- Keine permanenten Fehler

---

## 🐛 Troubleshooting

### Problem: "SHOPIFY_WEBHOOK_SECRET not configured"
```bash
# .env prüfen
cat .env | grep WEBHOOK_SECRET

# Falls leer, Webhook Secret von Shopify Admin kopieren
```

### Problem: "Invalid webhook signature"
```bash
# 1. Neues Secret generieren in Shopify Admin
# 2. .env aktualisieren
# 3. App neu starten
npm run dev
```

### Problem: "Could not read inventory"
```bash
# Scopes prüfen
cat shopify.app.toml | grep scopes

# Sollte sein:
# scopes = "write_products,read_inventory,write_inventory,read_orders"

# Falls falsch:
shopify app deploy  # Registriert neue Scopes
```

### Problem: Test-Endpoint gibt 404
```bash
# Route existiert?
ls app/routes/api.test-sync.jsx

# Server läuft?
curl http://localhost:3000/api/test-sync?sku=TEST-1&inventoryItemId=gid://shopify/InventoryItem/1
```

### Problem: Webhook kommt nicht an
```bash
# 1. Shopify CLI läuft?
npm run dev

# 2. Webhook in Shopify Admin registriert?
# → Settings → Notifications → Webhooks

# 3. URL korrekt?
# Sollte sein: https://xxx.ngrok.io/webhooks/orders-create
#          NOT: http://localhost:3000/webhooks/orders-create
```

---

## 📊 Test-Checkliste

| Test | Status | Notizen |
|------|--------|---------|
| **Test 1**: Manueller Sync via API | ⬜ | Test-Endpoint funktioniert? |
| **Test 2**: Webhook orders/create | ⬜ | Echte Bestellung synchronisiert? |
| **Test 3**: Error-Handling | ⬜ | Ungültige Inputs abgefangen? |
| **Test 4**: Rate-Limiting | ⬜ | Automatische Retries funktionieren? |
| **Integration**: Mehrere Gruppen | ⬜ | Bestellung mit 2+ Gruppen synct beide? |
| **Edge-Case**: Keine Geschwister | ⬜ | SKU ohne Geschwister: Kein Crash? |

---

## 🎉 Nächste Schritte

### Wenn alle Tests bestanden:
✅ **Ihre App ist produktionsreif!** (für die Core-Funktionalität)

**Option A**: Sofort deployen
```bash
shopify app deploy
```

**Option B**: Noch mehr Features (Phase 3-5)
- Phase 3: Datenbank-Logging für Audit-Trail
- Phase 4: UI-Dashboard mit Sync-Historie
- Phase 5: Production-Deployment auf Fly.io

**Option C**: Im Store aktivieren
1. Shopify Partners Dashboard → Apps → Ihre App
2. "Test on development store" klicken
3. Store auswählen → Installieren

---

## 📞 Support

**Fragen zur Testing?**
> "Warum funktioniert Test X nicht?"

**Deployment-Hilfe?**
> "Wie deploye ich auf Fly.io?"

**Phase 3 starten?**
> "Starte Phase 3 (Datenbank & Logging)"

---

**Viel Erfolg beim Testing!** 🚀
