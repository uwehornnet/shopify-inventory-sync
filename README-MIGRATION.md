# Schaltauge Shopify App - Migration README

**Status**: ✅ Phase 1 abgeschlossen
**Framework**: React Router 7 + Shopify CLI
**Zweck**: Automatische Inventar-Synchronisation für Produktvarianten

---

## 🎯 Was macht diese App?

Diese App synchronisiert automatisch den Lagerbestand von Shopify-Produktvarianten, die denselben Basis-SKU teilen.

**Beispiel**:
- Sie haben Varianten: `BXAAA-1`, `BXAAA-2`, `BXAAA-3` (verschiedene Farben/Größen)
- Kunde bestellt `BXAAA-1` (Bestand sinkt von 50 auf 49)
- App synchronisiert automatisch: `BXAAA-2` und `BXAAA-3` ebenfalls auf 49

**Trigger**: Shopify Webhooks (`orders/create`, `orders/paid`)

---

## 📁 Projektstruktur

```
schaltauge-shopifyapp/
├── app/
│   ├── lib/                        # ✅ PHASE 1: Core-Logik
│   │   ├── sku.js                  # SKU-Parsing (BXAAA-1 → BXAAA)
│   │   ├── shopify.js              # GraphQL-Client mit Rate-Limiting
│   │   ├── sync-engine.js          # Sync-Algorithmus
│   │   └── webhook-verify.js       # HMAC-Signaturprüfung
│   └── routes/                     # React Router Endpoints
│       └── (weitere in Phase 2)
├── .env.example                    # ✅ Template für Umgebungsvariablen
├── MIGRATION_LOG.md                # ✅ Detaillierter Fortschrittsbericht
├── NEXT_STEPS.md                   # ✅ Anleitung für Phase 2
└── README-MIGRATION.md             # ✅ Diese Datei
```

---

## 🚀 Schnellstart

### 1. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

Dann `.env` ausfüllen:
```bash
SHOPIFY_STORE_DOMAIN=schaltauge24.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-10
SHOPIFY_WEBHOOK_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
APP_URL=http://localhost:3000
```

**Wichtig**: `.env` nie in Git committen!

### 2. Dependencies installieren

```bash
npm install
```

### 3. Datenbank initialisieren

```bash
npm run setup
```

### 4. App lokal starten

```bash
npm run dev
```

---

## 📊 Migrations-Phasen

| Phase | Status | Beschreibung | Tokens |
|-------|--------|--------------|--------|
| **Phase 1** | ✅ Abgeschlossen | Core-Logik (Sync-Engine, GraphQL, SKU-Parsing) | ~28k |
| **Phase 2** | 🔄 Bereit | Webhook-Integration (`orders/create`, `orders/paid`) | ~25k |
| **Phase 3** | ⏳ Geplant | Datenbank-Logging (Sync-History) | ~20k |
| **Phase 4** | ⏳ Geplant | UI-Dashboard (Polaris-Komponenten) | ~40k |
| **Phase 5** | ⏳ Geplant | Testing & Deployment (Fly.io / Shopify) | ~20k |

**Aktueller Token-Verbrauch**: ~28.000 / 200.000
**Verbleibende Tokens**: ~137.000 ✅

---

## 📖 Wichtige Dateien

### Für Entwickler
- **`MIGRATION_LOG.md`**: Detaillierte technische Dokumentation der Migration
- **`NEXT_STEPS.md`**: Schritt-für-Schritt Anleitung für Phase 2
- **`app/lib/sync-engine.js`**: Kern-Algorithmus (wichtigste Datei!)

### Für Shopify-Konfiguration
- **`.env.example`**: Welche Umgebungsvariablen benötigt werden
- **`shopify.app.toml`**: App-Konfiguration (Scopes, Webhooks)

---

## 🔧 Core-Funktionalität (Phase 1)

### SKU-Parsing (`app/lib/sku.js`)
```javascript
extractGroupSku("BXAAA-1")      // → "BXAAA"
extractGroupSku("XXXXX-160-1")  // → "XXXXX-160"
```

### GraphQL-Client (`app/lib/shopify.js`)
- ✅ Automatisches Rate-Limiting (429 Handling)
- ✅ Retry bei Throttling
- ✅ Error-Handling

### Sync-Engine (`app/lib/sync-engine.js`)
```javascript
await syncInventoryForVariant('BXAAA-1', 'gid://shopify/InventoryItem/123')
// → Findet alle Varianten mit SKU BXAAA-*
// → Liest aktuellen Bestand von BXAAA-1
// → Setzt alle Geschwister auf denselben Wert
```

---

## 🧪 Testing (Phase 1)

Die Core-Logik ist bereits testbar:

```javascript
// In Node.js REPL oder Test-Script:
import { syncInventoryForVariant } from './app/lib/sync-engine.js';

const result = await syncInventoryForVariant(
  'BXAAA-1',
  'gid://shopify/InventoryItem/123456789'
);

console.log(result);
/*
{
  groupSku: "BXAAA",
  sourceVariantSku: "BXAAA-1",
  quantity: 47,
  siblingsFound: 3,
  siblingsUpdated: 2,
  errors: []
}
*/
```

**Voraussetzung**: `.env` mit validen Shopify-Credentials.

---

## 🔐 Sicherheit

### Webhook-Verifizierung
Alle Webhooks werden via HMAC-SHA256 verifiziert:
```javascript
verifyShopifyWebhook(rawBody, hmacHeader, secret)
```

### .gitignore
Folgende Dateien sind bereits ausgeschlossen:
```
.env
.env.local
*.sqlite
*.sqlite-journal
node_modules/
```

---

## 🚢 Deployment-Optionen

### Option 1: Shopify CLI (Einfachste)
```bash
shopify app deploy
```

### Option 2: Fly.io (Empfohlen)
```bash
# Dockerfile ist bereits vorhanden
flyctl launch
flyctl deploy
```

### Option 3: Railway, Render, etc.
- Docker-basiert (siehe `Dockerfile`)
- PostgreSQL für Produktion empfohlen (statt SQLite)

---

## 📚 Weiterführende Dokumentation

### Interne Docs
- **Detaillierter Tech-Report**: `MIGRATION_LOG.md`
- **Phase 2 Anleitung**: `NEXT_STEPS.md`

### Externe Docs
- [Shopify Webhooks](https://shopify.dev/docs/apps/build/webhooks)
- [Shopify GraphQL API](https://shopify.dev/docs/api/admin-graphql)
- [React Router Docs](https://reactrouter.com)
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)

---

## ❓ Häufige Fragen

### Warum React Router statt Next.js?
- Shopify CLI Integration (OAuth, Session-Management)
- Bessere Shopify-Entwicklererfahrung
- Einfachere Deployment-Optionen

### Warum Direct GraphQL statt Shopify SDK?
- Volle Kontrolle über Rate-Limiting
- Keine zusätzlichen Dependencies
- Einfacher zu debuggen

### Kann ich die alte Vercel-App parallel laufen lassen?
- Ja, aber nicht empfohlen (doppelte Webhooks!)
- Besser: Alte App deaktivieren nach Migration

---

## 🐛 Troubleshooting

### "SHOPIFY_ACCESS_TOKEN is undefined"
→ `.env` Datei erstellen und ausfüllen

### "Invalid webhook signature"
→ `SHOPIFY_WEBHOOK_SECRET` in `.env` prüfen

### "Rate limited"
→ Delay in `sync-engine.js` erhöhen (200ms → 500ms)

### "Could not read inventory"
→ Scopes prüfen: `read_inventory`, `write_inventory`

---

## 📞 Support & Weitermachen

**Phase 2 starten?**
> "Starte Phase 2 laut NEXT_STEPS.md"

**Fragen zur Implementierung?**
> "Erkläre mir die Sync-Engine aus MIGRATION_LOG.md"

**Deployment-Hilfe?**
> "Wie deploye ich auf Fly.io?"

---

**Erstellt**: 13. Februar 2026
**Autor**: Uwe Horn (mit Claude Cowork)
**Version**: v0.1.0 (Phase 1)
