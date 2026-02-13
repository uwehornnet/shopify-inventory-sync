import { NextResponse } from "next/server";
import { syncInventoryForVariant } from "@/lib/sync-engine";
import { shopifyGraphQL } from "@/lib/shopify";
import { extractGroupSku } from "@/lib/sku";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test-Endpoint: Manuell einen Sync für eine SKU auslösen.
 *
 * GET /api/test-sync?sku=BXAAA-1
 */
export async function GET(request) {
	const sku = request.nextUrl.searchParams.get("sku");

	if (!sku) {
		return NextResponse.json({ error: "Missing ?sku= parameter. Example: ?sku=BXAAA-1" }, { status: 400 });
	}

	const groupSku = extractGroupSku(sku);
	if (!groupSku) {
		return NextResponse.json({ error: `Invalid SKU format: "${sku}". Expected format: BXAAA-1` }, { status: 400 });
	}

	// Variante in Shopify suchen
	const data = await shopifyGraphQL(
		`query findVariant($query: String!) {
      productVariants(first: 1, query: $query) {
        edges {
          node {
            id
            sku
            inventoryItem { id }
          }
        }
      }
    }`,
		{ query: `sku:${sku}` },
	);

	const variant = data.productVariants.edges[0]?.node;
	if (!variant) {
		return NextResponse.json({ error: `Variant with SKU "${sku}" not found in Shopify` }, { status: 404 });
	}

	console.log(`[Test] Triggering sync for ${sku} (${variant.inventoryItem.id})`);

	const result = await syncInventoryForVariant(sku, variant.inventoryItem.id);

	return NextResponse.json(result);
}
