import { extractGroupSku } from "./sku";

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const SEARCH_VARIANTS_BY_SKU_QUERY = `
  query searchVariantsBySku($query: String!, $first: Int!, $after: String) {
    productVariants(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          sku
          inventoryItem {
            id
          }
          product {
            id
            title
          }
        }
      }
    }
  }
`;

const GET_INVENTORY_LEVEL_QUERY = `
  query getInventoryLevel($inventoryItemId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      inventoryLevels(first: 5) {
        edges {
          node {
            location {
              id
            }
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

const SET_INVENTORY_MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================================================
// Sync Logic
// ============================================================================

async function findSiblingVariants(admin, groupSku) {
	const allVariants = [];
	let hasNext = true;
	let cursor = null;

	while (hasNext) {
		const response = await admin.graphql(SEARCH_VARIANTS_BY_SKU_QUERY, {
			variables: {
				query: `sku:${groupSku}-*`,
				first: 100,
				after: cursor,
			},
		});
		const { data } = await response.json();
		const { pageInfo, edges } = data.productVariants;

		for (const { node } of edges) {
			const variantGroupSku = extractGroupSku(node.sku);
			if (variantGroupSku === groupSku) {
				allVariants.push(node);
			}
		}

		hasNext = pageInfo.hasNextPage;
		cursor = pageInfo.endCursor;

		if (hasNext) await delay(200);
	}

	return allVariants;
}

async function getInventoryLevel(admin, inventoryItemId) {
	const response = await admin.graphql(GET_INVENTORY_LEVEL_QUERY, {
		variables: { inventoryItemId },
	});
	const { data } = await response.json();

	const level = data.inventoryItem?.inventoryLevels?.edges?.[0]?.node;
	if (!level) return null;

	const available = level.quantities.find((q) => q.name === "available");
	if (available === undefined) return null;

	return {
		quantity: available.quantity,
		locationId: level.location.id,
	};
}

async function setInventoryLevel(admin, inventoryItemId, locationId, quantity) {
	const response = await admin.graphql(SET_INVENTORY_MUTATION, {
		variables: {
			input: {
				reason: "correction",
				name: "available",
				quantities: [{ inventoryItemId, locationId, quantity }],
			},
		},
	});
	const { data } = await response.json();

	const { userErrors } = data.inventorySetQuantities;
	if (userErrors.length > 0) {
		return { success: false, error: userErrors.map((e) => e.message).join(", ") };
	}

	return { success: true };
}

export async function syncInventoryForVariant(admin, variantSku, inventoryItemId) {
	const groupSku = extractGroupSku(variantSku);

	if (!groupSku) {
		return {
			groupSku: "UNKNOWN",
			sourceVariantSku: variantSku,
			quantity: 0,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: [`Invalid SKU format: "${variantSku}"`],
		};
	}

	console.log(`[Sync] Starting sync for group ${groupSku} (triggered by ${variantSku})`);

	const inventoryLevel = await getInventoryLevel(admin, inventoryItemId);

	if (!inventoryLevel) {
		return {
			groupSku,
			sourceVariantSku: variantSku,
			quantity: 0,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: [`Could not read inventory for ${variantSku}`],
		};
	}

	const { quantity, locationId } = inventoryLevel;
	console.log(`[Sync] ${groupSku}: current quantity = ${quantity} at ${locationId}`);

	const siblings = await findSiblingVariants(admin, groupSku);
	console.log(`[Sync] ${groupSku}: found ${siblings.length} siblings`);

	const errors = [];
	let updated = 0;

	for (const sibling of siblings) {
		if (sibling.inventoryItem.id === inventoryItemId) continue;

		try {
			const result = await setInventoryLevel(admin, sibling.inventoryItem.id, locationId, quantity);

			if (result.success) {
				updated++;
			} else {
				errors.push(`${sibling.sku}: ${result.error}`);
			}

			await delay(200);
		} catch (err) {
			errors.push(`${sibling.sku}: ${err.message || String(err)}`);
		}
	}

	console.log(
		`[Sync] ${groupSku}: updated ${updated}/${siblings.length - 1} siblings to quantity ${quantity}` +
			(errors.length > 0 ? ` (${errors.length} errors)` : ""),
	);

	return {
		groupSku,
		sourceVariantSku: variantSku,
		quantity,
		siblingsFound: siblings.length,
		siblingsUpdated: updated,
		errors,
	};
}
