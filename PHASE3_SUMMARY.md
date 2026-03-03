# Phase 3: Datenbank & Logging - Zusammenfassung

**Status**: ✅ Abgeschlossen
**Version**: v0.3.0
**Datum**: 16. Februar 2026

---

## 🎯 Was wurde erreicht?

Phase 3 fügt ein **vollständiges Audit-Trail-System** hinzu. Jeder Sync wird jetzt in der Datenbank protokolliert mit:
- ✅ Trigger-Info (Webhook vs. Manual)
- ✅ Order-Details (ID, Nummer)
- ✅ SKU-Info (Gruppe, Quelle, Inventory Item ID)
- ✅ Sync-Ergebnis (Erfolg, Bestand, Geschwister)
- ✅ Fehler-Details (als JSON)
- ✅ Performance-Daten (Dauer in ms)

---

## 📁 Neue/Geänderte Dateien

### ✅ Neu erstellt

```
app/
├── lib/
│   └── sync-engine-with-logging.js    # ✅ NEU: Sync mit DB-Logging
└── routes/
    └── api.sync-history.jsx            # ✅ NEU: History API-Endpoint

prisma/
├── schema.prisma                       # ✅ ERWEITERT: SyncLog Model
└── migrations/
    └── 20260216_add_sync_log_table/
        └── migration.sql                # ✅ NEU: DB-Migration
```

### ✅ Aktualisiert

```
app/routes/
├── webhooks.orders-create.jsx          # ✅ Nutzt jetzt Logging-Funktion
└── webhooks.orders-paid.jsx            # ✅ Nutzt jetzt Logging-Funktion
```

---

## 🗄️ Datenbank-Schema

### Neue Tabelle: `SyncLog`

```prisma
model SyncLog {
  id                 String   @id @default(uuid())
  createdAt          DateTime @default(now())

  // Trigger-Info
  trigger            String   // "webhook:orders/create" | "webhook:orders/paid" | "manual"
  orderId            String?  // Shopify Order ID (falls Webhook)
  orderNumber        String?  // Shopify Order Number (falls Webhook)

  // SKU-Info
  groupSku           String   // z.B. "BXAAA"
  sourceVariantSku   String   // z.B. "BXAAA-1"
  inventoryItemId    String   // gid://shopify/InventoryItem/...

  // Sync-Ergebnis
  success            Boolean
  quantity           Int?     // Bestand nach Sync
  siblingsFound      Int      @default(0)
  siblingsUpdated    Int      @default(0)

  // Fehler (JSON Array als String)
  errors             String?  // JSON-serialisierte Array von Error-Messages

  // Performance
  durationMs         Int?     // Dauer des Syncs in Millisekunden

  @@index([createdAt])
  @@index([groupSku])
  @@index([success])
}
```

**Indizes für Performance**:
- `createdAt` - Schnelle Zeitbereichs-Abfragen
- `groupSku` - Filtern nach SKU-Gruppe
- `success` - Filtern nach Erfolg/Fehler

---

## 🔧 Neue Funktionalität

### 1. `syncInventoryForVariantWithLogging()`

**Location**: `app/lib/sync-engine-with-logging.js`

**Erweitert die Original-Funktion um**:
- Automatisches Speichern in Datenbank
- Trigger-Metadaten (Webhook vs. Manual)
- Performance-Messung (Dauer in ms)
- Rückgabe der Log-ID für Referenzierung

**Beispiel-Aufruf**:
```javascript
const result = await syncInventoryForVariantWithLogging(
  "BXAAA-1",
  "gid://shopify/InventoryItem/123",
  {
    trigger: "webhook:orders/create",
    orderId: "5678901234",
    orderNumber: "1001"
  }
);

console.log(result.logId); // UUID des Log-Eintrags
```

**Response-Struktur**:
```json
{
  "logId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "groupSku": "BXAAA",
  "sourceVariantSku": "BXAAA-1",
  "quantity": 47,
  "siblingsFound": 3,
  "siblingsUpdated": 2,
  "errors": []
}
```

---

### 2. Sync-History API

**Endpoint**: `GET /api/sync-history`

**Query-Parameter**:
- `limit` - Anzahl der Logs (default: 50, max: 200)
- `offset` - Offset für Pagination (default: 0)
- `groupSku` - Filter nach Gruppen-SKU (z.B. `BXAAA`)
- `success` - Filter nach Erfolg (`true` / `false`)
- `since` - Filter nach Datum (ISO 8601, z.B. `2026-02-01T00:00:00Z`)

**Beispiel-Requests**:
```bash
# Letzte 10 Syncs
curl "http://localhost:3000/api/sync-history?limit=10"

# Nur Fehler
curl "http://localhost:3000/api/sync-history?success=false"

# Bestimmte SKU-Gruppe
curl "http://localhost:3000/api/sync-history?groupSku=BXAAA"

# Seit bestimmtem Datum
curl "http://localhost:3000/api/sync-history?since=2026-02-15T00:00:00Z"

# Pagination
curl "http://localhost:3000/api/sync-history?limit=50&offset=50"
```

**Response-Struktur**:
```json
{
  "success": true,
  "logs": [
    {
      "id": "a1b2c3d4...",
      "createdAt": "2026-02-16T10:30:45.123Z",
      "trigger": "webhook:orders/create",
      "orderId": "5678901234",
      "orderNumber": "1001",
      "groupSku": "BXAAA",
      "sourceVariantSku": "BXAAA-1",
      "inventoryItemId": "gid://shopify/InventoryItem/123",
      "success": true,
      "quantity": 47,
      "siblingsFound": 3,
      "siblingsUpdated": 2,
      "errors": [],
      "durationMs": 1250
    }
  ],
  "stats": {
    "total": 42,
    "returned": 10,
    "hasMore": true,
    "successRate": 95.24
  },
  "pagination": {
    "limit": 10,
    "offset": 0,
    "nextOffset": 10
  }
}
```

**Stats-Berechnung**:
- `total` - Gesamtanzahl Logs (mit Filter)
- `returned` - Anzahl in dieser Response
- `hasMore` - Gibt es weitere Logs?
- `successRate` - Erfolgsrate in % (mit Filter)

---

## 🔄 Workflow-Update

### Vorher (Phase 2):
```
Webhook → Sync → Response (keine Persistenz)
```

### Jetzt (Phase 3):
```
Webhook → Sync → DB-Log → Response (mit Log-ID)
                   ↓
           Audit-Trail in SQLite
```

**Vorteile**:
- ✅ Vollständige Historie aller Syncs
- ✅ Fehleranalyse möglich (welche SKUs, wann, warum)
- ✅ Performance-Monitoring (Sync-Dauer)
- ✅ Compliance/Audit-Anforderungen erfüllbar

---

## 🧪 Testing

### Test 1: Migration ausführen

```bash
cd schaltauge-shopifyapp

# Prisma Client neu generieren
npx prisma generate

# Migration ausführen (erstellt SyncLog-Tabelle)
npx prisma migrate deploy
```

**Erwartete Ausgabe**:
```
✔ Generated Prisma Client
✔ Applied migration 20260216_add_sync_log_table
```

---

### Test 2: Sync mit Logging

```bash
# App starten
npm run dev

# Sync auslösen (z.B. via Webhook oder Test-Endpoint)
curl "https://abc123.ngrok.io/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123"
```

**Terminal zeigt**:
```
[Sync] Starting sync for group BXAAA (triggered by BXAAA-1)
[Sync] BXAAA: current quantity = 47 at gid://shopify/Location/123
[Sync] BXAAA: found 3 siblings
[Sync] BXAAA: updated 2/2 siblings to quantity 47 (1250ms)
```

**Response enthält Log-ID**:
```json
{
  "success": true,
  "result": {
    "logId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "groupSku": "BXAAA",
    ...
  }
}
```

---

### Test 3: History abrufen

```bash
# Alle Logs
curl "http://localhost:3000/api/sync-history"

# Nur Fehler
curl "http://localhost:3000/api/sync-history?success=false"

# Bestimmte SKU
curl "http://localhost:3000/api/sync-history?groupSku=BXAAA&limit=5"
```

**Response enthält**:
- Logs-Array mit allen Details
- Stats (Total, Success-Rate, etc.)
- Pagination-Info

---

### Test 4: Datenbank direkt prüfen

```bash
# SQLite öffnen
npx prisma studio

# Oder via SQL:
sqlite3 prisma/dev.sqlite "SELECT * FROM SyncLog ORDER BY createdAt DESC LIMIT 5;"
```

**Erwartetes Ergebnis**:
- Tabelle `SyncLog` existiert
- Einträge für jeden Sync
- Timestamps, SKUs, Erfolg/Fehler korrekt

---

## 📊 Beispiel-Daten

### Erfolgreicher Sync (Webhook):
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "createdAt": "2026-02-16T10:30:45.123Z",
  "trigger": "webhook:orders/create",
  "orderId": "5678901234",
  "orderNumber": "1001",
  "groupSku": "BXAAA",
  "sourceVariantSku": "BXAAA-1",
  "inventoryItemId": "gid://shopify/InventoryItem/123456789",
  "success": true,
  "quantity": 47,
  "siblingsFound": 3,
  "siblingsUpdated": 2,
  "errors": null,
  "durationMs": 1250
}
```

### Fehlgeschlagener Sync (Invalid SKU):
```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "createdAt": "2026-02-16T10:35:12.456Z",
  "trigger": "manual",
  "orderId": null,
  "orderNumber": null,
  "groupSku": "UNKNOWN",
  "sourceVariantSku": "INVALID-SKU",
  "inventoryItemId": "gid://shopify/InventoryItem/987654321",
  "success": false,
  "quantity": null,
  "siblingsFound": 0,
  "siblingsUpdated": 0,
  "errors": "[\"Invalid SKU format: \\\"INVALID-SKU\\\"\"]",
  "durationMs": 50
}
```

---

## 🛠 Nutzungsszenarien

### Szenario 1: Fehleranalyse
**Problem**: Sync schlägt manchmal fehl
**Lösung**:
```bash
curl "http://localhost:3000/api/sync-history?success=false"
# → Zeigt alle fehlgeschlagenen Syncs mit Fehler-Details
```

### Szenario 2: Performance-Monitoring
**Frage**: Wie lange dauern Syncs durchschnittlich?
**Lösung**:
```bash
curl "http://localhost:3000/api/sync-history?limit=100"
# → `durationMs`-Werte analysieren
# → Durchschnitt, Min, Max berechnen
```

### Szenario 3: SKU-spezifische Historie
**Frage**: Wann wurde BXAAA zuletzt synchronisiert?
**Lösung**:
```bash
curl "http://localhost:3000/api/sync-history?groupSku=BXAAA&limit=1"
# → Zeigt letzten Sync für diese Gruppe
```

### Szenario 4: Order-Tracking
**Frage**: Hat Order #1001 einen Sync ausgelöst?
**Lösung**:
```bash
# Direkt in SQLite:
sqlite3 prisma/dev.sqlite "SELECT * FROM SyncLog WHERE orderNumber = '1001';"
```

---

## 🚀 Nächste Schritte

### Option A: Phase 4 - UI-Dashboard
- Polaris-Tabelle mit Sync-Historie
- Filter & Suche (SKU, Datum, Erfolg)
- Manueller Sync-Trigger (Button)
- Real-time Updates (optional)

### Option B: Sofort Production-Ready
Die App ist jetzt vollständig nutzbar:
```bash
# Migration ausführen
npx prisma migrate deploy

# App deployen
shopify app deploy

# Im Store installieren
# → Funktioniert vollständig mit Logging!
```

---

## 💡 Hinweise

### Datenbank-Wartung
SQLite-Datenbank wächst mit der Zeit:
- **Empfehlung**: Alte Logs regelmäßig archivieren/löschen
- **Beispiel**: Logs älter als 90 Tage löschen
```sql
DELETE FROM SyncLog WHERE createdAt < datetime('now', '-90 days');
```

### Performance-Optimierung
Bei vielen Logs (>10.000):
- Indizes sind bereits optimiert ✅
- Pagination nutzen (limit/offset)
- Filter nutzen (groupSku, success, since)

### Backup-Strategie
SQLite-Datenbank sichern:
```bash
# Backup erstellen
cp prisma/dev.sqlite prisma/dev.sqlite.backup

# Oder bei Deployment: Fly.io Volumes nutzen
```

---

**Phase 3 abgeschlossen!** 🎉
**Version**: v0.3.0
**Token-Verbrauch**: ~12.000 Tokens
**Verbleibend**: ~104.000 Tokens
