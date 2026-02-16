import { NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhook-verify";
import { syncInventoryForVariant } from "@/lib/sync-engine";
import { extractGroupSku } from "@/lib/sku";
import { shopifyGraphQL } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * refunds/create Webhook
 *
 * Bei einer Rückerstattung mit Restock erhöht Shopify den available-Bestand.
 * Wir synchronisieren alle Geschwister auf den neuen Wert.
 *
 * Wichtig: Nicht jede Rückerstattung führt zu einem Restock.
 * Shopify passt den Bestand nur an wenn "Restock" ausgewählt wurde.
 * Wir lesen einfach den aktuellen available-Wert und syncen –
 * wenn kein Restock stattfand, hat sich nichts geändert und der Sync ist ein No-Op.
 */
export async function POST(request) {
	const startTime = Date.now();

	try {
		const rawBody = await request.text();
		const hmac = request.headers.get("x-shopify-hmac-sha256");

		const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
		if (secret && !verifyShopifyWebhook(rawBody, hmac, secret)) {
			console.error("[Webhook refunds/create] Invalid HMAC signature");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		const refund = JSON.parse(rawBody);
		const orderId = refund.order_id;

		console.log(
			`[Webhook refunds/create] Refund for order #${orderId} with ${refund.refund_line_items?.length || 0} line items`,
		);

		const results = [];
		const processedGroups = new Set();

		for (const refundItem of refund.refund_line_items || []) {
			const lineItem = refundItem.line_item;
			if (!lineItem || !lineItem.sku) continue;

			const groupSku = extractGroupSku(lineItem.sku);
			if (!groupSku) continue;
			if (processedGroups.has(groupSku)) continue;
			processedGroups.add(groupSku);

			let inventoryItemId = lineItem.inventory_item_id
				? `gid://shopify/InventoryItem/${lineItem.inventory_item_id}`
				: "";

			if (!inventoryItemId && lineItem.variant_id) {
				inventoryItemId = await lookupInventoryItemId(`gid://shopify/ProductVariant/${lineItem.variant_id}`);
			}

			if (!inventoryItemId) {
				results.push({
					groupSku,
					sourceVariantSku: lineItem.sku,
					quantity: 0,
					siblingsFound: 0,
					siblingsUpdated: 0,
					errors: [`Could not find inventoryItemId for variant ${lineItem.variant_id}`],
				});
				continue;
			}

			const result = await syncInventoryForVariant(lineItem.sku, inventoryItemId);
			results.push(result);
		}

		const duration = Date.now() - startTime;
		const hasErrors = results.some((r) => r.errors.length > 0);
		const totalUpdated = results.reduce((sum, r) => sum + r.siblingsUpdated, 0);

		console.log(
			`[Webhook refunds/create] Order #${orderId} done in ${duration}ms: ` +
				`${results.length} groups, ${totalUpdated} variants updated` +
				(hasErrors ? " (with errors)" : ""),
		);

		return NextResponse.json({
			status: hasErrors ? "partial" : "ok",
			trigger: "refunds/create",
			order: `#${orderId}`,
			duration: `${duration}ms`,
			results,
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Webhook refunds/create] Error after ${duration}ms:`, error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
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
