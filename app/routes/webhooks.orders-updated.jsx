import { authenticate } from "../shopify.server";
import { syncInventoryForVariantWithLogging } from "~/lib/sync-engine-with-logging";
import { extractGroupSku } from "~/lib/sku";

/**
 * Webhook Handler: orders/updated
 *
 * Feuert bei jeder Aktualisierung einer Bestellung — inkl. Stornierungen.
 * Wir reagieren NUR wenn die Bestellung storniert wurde (cancelled_at gesetzt).
 *
 * Warum orders/updated statt orders/cancelled?
 * Shopify kennt kein eigenständiges "orders/cancelled" Webhook-Topic.
 * Stornierungen werden als Order-Update geliefert.
 *
 * Flow bei Stornierung:
 * 1. Shopify setzt cancelled_at auf der Bestellung
 * 2. Shopify erhöht ggf. Lagerbestand (wenn "Artikel wieder einlagern" gewählt)
 * 3. Shopify feuert orders/updated
 * 4. Wir prüfen cancelled_at → starten Sync für alle Gruppen-Varianten
 */
export async function action({ request }) {
	const { admin, payload: order } = await authenticate.webhook(request);

	// Nur bei Stornierungen reagieren
	if (!order.cancelled_at) {
		return Response.json({ skipped: true, reason: "not cancelled" }, { status: 200 });
	}

	console.log(
		`[Webhook] orders/updated (storniert): Order #${order.order_number || order.id}` +
			(order.cancel_reason ? ` — Grund: ${order.cancel_reason}` : "")
	);

	// Kurz warten, damit Shopify die Bestandsrückbuchung verarbeiten kann
	await new Promise((resolve) => setTimeout(resolve, 2000));

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
				trigger: "webhook:orders/cancelled",
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
	console.log(`[Webhook] orders/updated (storniert) completed: ${successCount}/${results.length} syncs successful`);

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
