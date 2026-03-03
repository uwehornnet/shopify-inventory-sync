import { json } from "react-router";
import { syncInventoryForVariant } from "~/lib/sync-engine";

/**
 * Test-Endpoint: Manueller Inventory Sync
 *
 * Erlaubt manuelles Triggern eines Syncs für Debugging und Testing.
 *
 * Aufruf:
 *   GET /api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123456789
 *
 * Response:
 *   {
 *     success: true,
 *     result: {
 *       groupSku: "BXAAA",
 *       sourceVariantSku: "BXAAA-1",
 *       quantity: 47,
 *       siblingsFound: 3,
 *       siblingsUpdated: 2,
 *       errors: []
 *     }
 *   }
 */
export async function loader({ request }) {
	const url = new URL(request.url);
	const sku = url.searchParams.get("sku");
	const inventoryItemId = url.searchParams.get("inventoryItemId");

	// Parameter-Validierung
	if (!sku || !inventoryItemId) {
		return json(
			{
				error: "Missing required parameters",
				usage: {
					url: "/api/test-sync",
					params: {
						sku: "Variant SKU (e.g., BXAAA-1)",
						inventoryItemId: "Shopify Inventory Item ID (e.g., gid://shopify/InventoryItem/123456789)",
					},
					example: "/api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123456789",
				},
			},
			{ status: 400 }
		);
	}

	console.log(`[Test-Sync] Manual sync requested for SKU: ${sku}`);

	// Sync ausführen
	try {
		const result = await syncInventoryForVariant(sku, inventoryItemId);

		const success = result.errors.length === 0;

		console.log(
			`[Test-Sync] ${success ? "✓" : "✗"} ${result.groupSku}: ${result.siblingsUpdated}/${result.siblingsFound} variants synced to qty ${result.quantity}`
		);

		if (result.errors.length > 0) {
			console.warn(`[Test-Sync] Errors encountered:`, result.errors);
		}

		return json(
			{
				success,
				result: {
					groupSku: result.groupSku,
					sourceVariantSku: result.sourceVariantSku,
					quantity: result.quantity,
					siblingsFound: result.siblingsFound,
					siblingsUpdated: result.siblingsUpdated,
					errors: result.errors,
				},
			},
			{ status: success ? 200 : 500 }
		);
	} catch (error) {
		console.error(`[Test-Sync] ✗ Sync failed:`, error);

		return json(
			{
				success: false,
				error: error.message || String(error),
				stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
			},
			{ status: 500 }
		);
	}
}
