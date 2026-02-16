import { NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhook-verify";
import { syncInventoryForVariant } from "@/lib/sync-engine";
import { extractGroupSku } from "@/lib/sku";
import { shopifyGraphQL } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * orders/cancelled Webhook
 *
 * Wenn eine Bestellung storniert wird, gibt Shopify den reservierten
 * Bestand frei (available steigt). Wir synchronisieren alle Geschwister.
 */
export async function POST(request) {
	const startTime = Date.now();

	try {
		const rawBody = await request.text();
		const hmac = request.headers.get("x-shopify-hmac-sha256");

		const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
		if (secret && !verifyShopifyWebhook(rawBody, hmac, secret)) {
			console.error("[Webhook orders/cancelled] Invalid HMAC signature");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		const order = JSON.parse(rawBody);
		const orderName = order.name || `#${order.id}`;

		console.log(
			`[Webhook orders/cancelled] Order ${orderName} cancelled with ${order.line_items?.length || 0} line items`,
		);

		const results = await processOrderLineItems(order);

		const duration = Date.now() - startTime;
		const hasErrors = results.some((r) => r.errors.length > 0);
		const totalUpdated = results.reduce((sum, r) => sum + r.siblingsUpdated, 0);

		console.log(
			`[Webhook orders/cancelled] Order ${orderName} done in ${duration}ms: ` +
				`${results.length} groups, ${totalUpdated} variants updated` +
				(hasErrors ? " (with errors)" : ""),
		);

		return NextResponse.json({
			status: hasErrors ? "partial" : "ok",
			trigger: "orders/cancelled",
			order: orderName,
			duration: `${duration}ms`,
			results,
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Webhook orders/cancelled] Error after ${duration}ms:`, error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

async function processOrderLineItems(order) {
	const results = [];
	const processedGroups = new Set();

	for (const item of order.line_items || []) {
		if (!item.sku) continue;

		const groupSku = extractGroupSku(item.sku);
		if (!groupSku) continue;
		if (processedGroups.has(groupSku)) continue;
		processedGroups.add(groupSku);

		let inventoryItemId = item.inventory_item_id ? `gid://shopify/InventoryItem/${item.inventory_item_id}` : "";

		if (!inventoryItemId) {
			inventoryItemId = await lookupInventoryItemId(`gid://shopify/ProductVariant/${item.variant_id}`);
			if (!inventoryItemId) {
				results.push({
					groupSku,
					sourceVariantSku: item.sku,
					quantity: 0,
					siblingsFound: 0,
					siblingsUpdated: 0,
					errors: [`Could not find inventoryItemId for variant ${item.variant_id}`],
				});
				continue;
			}
		}

		const result = await syncInventoryForVariant(item.sku, inventoryItemId);
		results.push(result);
	}

	return results;
}

async function lookupInventoryItemId(variantGid) {
	try {
		const data = await shopifyGraphQL(
			`query getVariant($id: ID!) {
        productVariant(id: $id) {
          inventoryItem { id }
        }
      }`,
			{ id: variantGid },
		);
		return data.productVariant?.inventoryItem?.id ?? null;
	} catch {
		return null;
	}
}
