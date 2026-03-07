import { authenticate } from "../shopify.server";
import { syncInventoryForVariantWithLogging } from "~/lib/sync-engine-with-logging";

/**
 * Test-Endpoint: Manueller Inventory Sync (mit DB-Logging)
 *
 * Erlaubt manuelles Triggern eines Syncs für Debugging und Testing.
 *
 * Aufruf:
 *   GET /api/test-sync?sku=BXAAA-1&inventoryItemId=gid://shopify/InventoryItem/123456789
 */
export async function loader({ request }) {
	const { admin } = await authenticate.admin(request);

	const url = new URL(request.url);
	const sku = url.searchParams.get("sku");
	const inventoryItemId = url.searchParams.get("inventoryItemId");

	if (!sku || !inventoryItemId) {
		return Response.json(
			{
				error: "Missing required parameters",
				usage: {
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

	try {
		const result = await syncInventoryForVariantWithLogging(admin, sku, inventoryItemId, {
			trigger: "manual:test",
		});

		const success = result.errors.length === 0;

		console.log(
			`[Test-Sync] ${success ? "✓" : "✗"} ${result.groupSku}: ${result.siblingsUpdated}/${result.siblingsFound} variants synced to qty ${result.quantity} (log: ${result.logId})`
		);

		return Response.json(
			{
				success,
				logId: result.logId,
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

		return Response.json(
			{
				success: false,
				error: error.message || String(error),
				stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
			},
			{ status: 500 }
		);
	}
}
