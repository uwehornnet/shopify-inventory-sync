import { authenticate } from "../shopify.server";
import { syncInventoryForVariantWithLogging } from "~/lib/sync-engine-with-logging";
import { extractGroupSku } from "~/lib/sku";

/**
 * Webhook Handler: orders/paid
 *
 * Backup-Trigger: Wird gefeuert, wenn eine Bestellung bezahlt wurde.
 * Dient als Sicherheitsnetz falls orders/create Webhook fehlschlägt.
 *
 * Flow:
 * 1. Authentifizierung & HMAC-Verifizierung via Framework
 * 2. Order-Daten aus Payload parsen
 * 3. Line-Items nach Gruppen-SKU deduplizieren
 * 4. Pro Gruppe: Sync-Engine aufrufen
 * 5. Status zurückgeben (200 OK)
 */
export async function action({ request }) {
	console.log("[Webhook] orders/paid received (backup trigger)");

	const { admin, payload: order } = await authenticate.webhook(request);

	console.log(`[Webhook] Order #${order.order_number || order.id} - ${order.line_items?.length || 0} items (paid)`);

	// Line Items extrahieren & nach Gruppen-SKU deduplizieren
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

		if (!item.inventory_item_id) {
			console.warn(`[Webhook] SKU "${sku}" has no inventory_item_id (inventory tracking disabled?), skipping`);
			continue;
		}

		if (!uniqueGroups.has(groupSku)) {
			const inventoryItemId = `gid://shopify/InventoryItem/${item.inventory_item_id}`;
			console.log(`[Webhook] Group ${groupSku}: SKU=${sku}, inventoryItemId=${inventoryItemId}`);
			uniqueGroups.set(groupSku, {
				sku: sku,
				inventoryItemId,
			});
		}
	}

	console.log(`[Webhook] Found ${uniqueGroups.size} unique group(s) to sync`);

	const results = [];

	for (const [groupSku, { sku, inventoryItemId }] of uniqueGroups) {
		try {
			console.log(`[Webhook] Syncing group ${groupSku} (from ${sku})`);

			const result = await syncInventoryForVariantWithLogging(admin, sku, inventoryItemId, {
				trigger: "webhook:orders/paid",
				orderId: order.id ? String(order.id) : null,
				orderNumber: order.order_number ? String(order.order_number) : null,
			});

			results.push({
				groupSku,
				success: result.errors.length === 0,
				logId: result.logId,
				...result,
			});

			const syncOk = result.errors.length === 0;
			console.log(
				`[Webhook] ${syncOk ? "✓" : "✗"} ${groupSku}: ${result.siblingsUpdated}/${result.siblingsFound} variants synced to qty ${result.quantity} (log: ${result.logId})` +
					(result.errors.length > 0 ? ` | errors: ${result.errors.join("; ")}` : "")
			);
		} catch (error) {
			console.error(`[Webhook] ✗ ${groupSku} sync failed:`, error);
			results.push({ groupSku, success: false, error: error.message || String(error) });
		}
	}

	const successCount = results.filter((r) => r.success).length;
	console.log(`[Webhook] orders/paid completed: ${successCount}/${results.length} syncs successful`);

	return Response.json(
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
