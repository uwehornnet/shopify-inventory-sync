import { json } from "react-router";
import { verifyShopifyWebhook } from "~/lib/webhook-verify";
import { syncInventoryForVariantWithLogging } from "~/lib/sync-engine-with-logging";
import { extractGroupSku } from "~/lib/sku";

/**
 * Webhook Handler: orders/create
 *
 * Wird gefeuert, wenn eine neue Bestellung in Shopify erstellt wird.
 * Synchronisiert automatisch die Lagerbestände aller Varianten mit gleicher Gruppen-SKU.
 *
 * Flow:
 * 1. HMAC-Signatur verifizieren (Sicherheit)
 * 2. Order-Daten parsen
 * 3. Line-Items nach Gruppen-SKU deduplizieren
 * 4. Pro Gruppe: Sync-Engine aufrufen
 * 5. Status zurückgeben (200 OK)
 */
export async function action({ request }) {
	console.log("[Webhook] orders/create received");

	// 1. Raw Body lesen (wichtig für HMAC-Verifizierung!)
	const rawBody = await request.text();

	// 2. HMAC-Signatur verifizieren
	const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
	const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

	if (!secret) {
		console.error("[Webhook] SHOPIFY_WEBHOOK_SECRET not configured");
		return json({ error: "Webhook secret not configured" }, { status: 500 });
	}

	if (!verifyShopifyWebhook(rawBody, hmacHeader, secret)) {
		console.warn("[Webhook] Invalid webhook signature");
		return json({ error: "Invalid webhook signature" }, { status: 401 });
	}

	// 3. Order parsen
	let order;
	try {
		order = JSON.parse(rawBody);
	} catch (error) {
		console.error("[Webhook] Failed to parse order JSON:", error);
		return json({ error: "Invalid JSON" }, { status: 400 });
	}

	console.log(`[Webhook] Order #${order.order_number || order.id} - ${order.line_items?.length || 0} items`);

	// 4. Line Items extrahieren & nach Gruppen-SKU deduplizieren
	const uniqueGroups = new Map();

	for (const item of order.line_items || []) {
		const sku = item.sku;

		if (!sku) {
			console.warn(`[Webhook] Line item "${item.name}" has no SKU, skipping`);
			continue;
		}

		const groupSku = extractGroupSku(sku);

		if (!groupSku) {
			console.warn(`[Webhook] SKU "${sku}" has invalid format, skipping`);
			continue;
		}

		// Deduplizierung: Nur ein Sync pro Gruppen-SKU
		if (!uniqueGroups.has(groupSku)) {
			uniqueGroups.set(groupSku, {
				sku: sku,
				inventoryItemId: `gid://shopify/InventoryItem/${item.inventory_item_id}`,
				productTitle: item.title,
				variantTitle: item.variant_title,
			});
		}
	}

	console.log(`[Webhook] Found ${uniqueGroups.size} unique group(s) to sync`);

	// 5. Sync für jede Gruppe ausführen (mit DB-Logging)
	const results = [];

	for (const [groupSku, { sku, inventoryItemId, productTitle }] of uniqueGroups) {
		try {
			console.log(`[Webhook] Syncing group ${groupSku} (from ${sku})`);

			const result = await syncInventoryForVariantWithLogging(sku, inventoryItemId, {
				trigger: "webhook:orders/create",
				orderId: order.id ? String(order.id) : null,
				orderNumber: order.order_number ? String(order.order_number) : null,
			});

			results.push({
				groupSku,
				success: result.errors.length === 0,
				logId: result.logId,
				...result,
			});

			console.log(
				`[Webhook] ✓ ${groupSku}: ${result.siblingsUpdated}/${result.siblingsFound} variants synced to qty ${result.quantity} (log: ${result.logId})`
			);
		} catch (error) {
			console.error(`[Webhook] ✗ ${groupSku} sync failed:`, error);
			results.push({
				groupSku,
				success: false,
				error: error.message || String(error),
			});
		}
	}

	// 6. Erfolgs-Status zurückgeben
	const successCount = results.filter((r) => r.success).length;
	console.log(`[Webhook] orders/create completed: ${successCount}/${results.length} syncs successful`);

	return json(
		{
			success: true,
			message: `Processed ${results.length} group(s)`,
			results: results.map((r) => ({
				groupSku: r.groupSku,
				success: r.success,
				logId: r.logId,
				siblingsUpdated: r.siblingsUpdated,
				quantity: r.quantity,
				error: r.error,
			})),
		},
		{ status: 200 }
	);
}
