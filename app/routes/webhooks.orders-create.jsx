import { authenticate } from "../shopify.server";
import { syncInventoryBySkuWithLogging } from "~/lib/sync-engine-with-logging";
import { extractGroupSku } from "~/lib/sku";

/**
 * Webhook Handler: orders/create
 *
 * Wird gefeuert, wenn eine neue Bestellung in Shopify erstellt wird.
 * Synchronisiert automatisch die Lagerbestände aller Varianten mit gleicher Gruppen-SKU.
 *
 * Wichtig: Wir nutzen syncInventoryBySkuWithLogging (SKU-Lookup via GraphQL),
 * da inventory_item_id im Webhook-Payload in manchen Fällen fehlt.
 */
export async function action({ request }) {
	console.log("[Webhook] orders/create received");

	const { admin, payload: order } = await authenticate.webhook(request);

	console.log(`[Webhook] Order #${order.order_number || order.id} - ${order.line_items?.length || 0} items`);

	// Line Items extrahieren & nach Gruppen-SKU deduplizieren (erste SKU pro Gruppe)
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

		if (!uniqueGroups.has(groupSku)) {
			uniqueGroups.set(groupSku, sku);
		}
	}

	console.log(`[Webhook] Found ${uniqueGroups.size} unique group(s) to sync`);

	const results = [];

	for (const [groupSku, sku] of uniqueGroups) {
		try {
			console.log(`[Webhook] Syncing group ${groupSku} (triggered by SKU ${sku})`);

			const result = await syncInventoryBySkuWithLogging(admin, sku, {
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
	console.log(`[Webhook] orders/create completed: ${successCount}/${results.length} syncs successful`);

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
