-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "groupSku" TEXT NOT NULL,
    "sourceVariantSku" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "quantity" INTEGER,
    "siblingsFound" INTEGER NOT NULL DEFAULT 0,
    "siblingsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "durationMs" INTEGER
);

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_groupSku_idx" ON "SyncLog"("groupSku");

-- CreateIndex
CREATE INDEX "SyncLog_success_idx" ON "SyncLog"("success");
