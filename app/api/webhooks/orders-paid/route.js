import { NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhook-verify";
import { syncInventoryForVariant } from "@/lib/sync-engine";
import { extractGroupSku } from "@/lib/sku";
import { shopifyGraphQL } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
	const startTime = Date.now();

	try {
		const rawBody = await request.text();
		const hmac = request.headers.get("x-shopify-hmac-sha256");

		// Webhook-Signatur prüfen
		const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
		if (secret && !verifyShopifyWebhook(rawBody, hmac, secret)) {
			console.error("[Webhook] Invalid HMAC signature");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}

		const order = JSON.parse(rawBody);
		const orderId = order.id;
		const orderName = order.name || `#${orderId}`;

		console.log(`[Webhook] Order ${orderName} received with ${order.line_items?.length || 0} line items`);

		// Line Items verarbeiten
		const lineItems = [];

		for (const item of order.line_items || []) {
			if (!item.sku) continue;

			const groupSku = extractGroupSku(item.sku);
			if (!groupSku) {
				console.log(`[Webhook] Skipping invalid SKU: "${item.sku}"`);
				continue;
			}

			lineItems.push({
				sku: item.sku,
				variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
				inventoryItemId: item.inventory_item_id ? `gid://shopify/InventoryItem/${item.inventory_item_id}` : "",
			});
		}

		if (lineItems.length === 0) {
			console.log(`[Webhook] Order ${orderName}: no valid SKUs found, skipping`);
			return NextResponse.json({ status: "no_valid_skus" });
		}

		// Deduplizieren nach Gruppen-SKU
		const processedGroups = new Set();
		const results = [];

		for (const item of lineItems) {
			const groupSku = extractGroupSku(item.sku);
			if (processedGroups.has(groupSku)) continue;
			processedGroups.add(groupSku);

			// Wenn kein inventoryItemId im Webhook, nachschlagen
			let inventoryItemId = item.inventoryItemId;
			if (!inventoryItemId) {
				inventoryItemId = await lookupInventoryItemId(item.variantId);
				if (!inventoryItemId) {
					results.push({
						groupSku,
						sourceVariantSku: item.sku,
						quantity: 0,
						siblingsFound: 0,
						siblingsUpdated: 0,
						errors: [`Could not find inventoryItemId for variant ${item.variantId}`],
					});
					continue;
				}
			}

			const result = await syncInventoryForVariant(item.sku, inventoryItemId);
			results.push(result);
		}

		const duration = Date.now() - startTime;
		const hasErrors = results.some((r) => r.errors.length > 0);
		const totalUpdated = results.reduce((sum, r) => sum + r.siblingsUpdated, 0);

		console.log(
			`[Webhook] Order ${orderName} complete in ${duration}ms: ` +
				`${results.length} groups, ${totalUpdated} variants updated` +
				(hasErrors ? " (with errors)" : ""),
		);

		return NextResponse.json({
			status: hasErrors ? "partial" : "ok",
			order: orderName,
			duration: `${duration}ms`,
			results,
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(`[Webhook] Error after ${duration}ms:`, error);
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
