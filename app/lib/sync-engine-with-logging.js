import { extractGroupSku } from "./sku";
import db from "~/db.server";

const FIND_VARIANT_BY_SKU_QUERY = `
  query findVariantBySku($query: String!) {
    productVariants(first: 5, query: $query) {
      edges {
        node {
          id
          sku
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

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
      tracked
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

	const item = data.inventoryItem;
	if (!item) return { error: `InventoryItem nicht gefunden (ID: ${inventoryItemId})` };
	if (!item.tracked) return { error: "Bestandsverfolgung für dieses Produkt deaktiviert" };

	const level = item.inventoryLevels?.edges?.[0]?.node;
	if (!level) return { error: "Kein Lagerort für dieses Produkt zugewiesen" };

	const available = level.quantities.find((q) => q.name === "available");
	if (available === undefined) return { error: "Verfügbare Menge nicht auslesbar" };

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
				ignoreCompareQuantity: true,
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

export async function syncInventoryForVariantWithLogging(admin, variantSku, inventoryItemId, options = {}) {
	const startTime = Date.now();
	const groupSku = extractGroupSku(variantSku);
	const { trigger = "manual", orderId = null, orderNumber = null } = options;

	if (!groupSku) {
		const logData = {
			id: crypto.randomUUID(),
			createdAt: new Date(),
			trigger,
			orderId,
			orderNumber,
			groupSku: "UNKNOWN",
			sourceVariantSku: variantSku,
			inventoryItemId,
			success: false,
			quantity: null,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: JSON.stringify([`Invalid SKU format: "${variantSku}"`]),
			durationMs: Date.now() - startTime,
		};

		await db.syncLog.create({ data: logData });

		return {
			logId: logData.id,
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

	if (!inventoryLevel || inventoryLevel.error) {
		const errorMsg = inventoryLevel?.error ?? `Could not read inventory for ${variantSku}`;
		console.error(`[Sync] ${groupSku}: ${errorMsg}`);
		const logData = {
			id: crypto.randomUUID(),
			createdAt: new Date(),
			trigger,
			orderId,
			orderNumber,
			groupSku,
			sourceVariantSku: variantSku,
			inventoryItemId,
			success: false,
			quantity: null,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: JSON.stringify([errorMsg]),
			durationMs: Date.now() - startTime,
		};

		await db.syncLog.create({ data: logData });

		return {
			logId: logData.id,
			groupSku,
			sourceVariantSku: variantSku,
			quantity: 0,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: [errorMsg],
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

	const success = errors.length === 0;
	const durationMs = Date.now() - startTime;

	console.log(
		`[Sync] ${groupSku}: updated ${updated}/${siblings.length - 1} siblings to quantity ${quantity}` +
			(errors.length > 0 ? ` (${errors.length} errors)` : "") +
			` (${durationMs}ms)`
	);

	const logData = {
		id: crypto.randomUUID(),
		createdAt: new Date(),
		trigger,
		orderId,
		orderNumber,
		groupSku,
		sourceVariantSku: variantSku,
		inventoryItemId,
		success,
		quantity,
		siblingsFound: siblings.length,
		siblingsUpdated: updated,
		errors: errors.length > 0 ? JSON.stringify(errors) : null,
		durationMs,
	};

	await db.syncLog.create({ data: logData });

	return {
		logId: logData.id,
		groupSku,
		sourceVariantSku: variantSku,
		quantity,
		siblingsFound: siblings.length,
		siblingsUpdated: updated,
		errors,
	};
}

// ============================================================================
// Manueller Sync per SKU (ohne inventoryItemId)
// ============================================================================

async function lookupInventoryItemId(admin, variantSku) {
	const response = await admin.graphql(FIND_VARIANT_BY_SKU_QUERY, {
		variables: { query: `sku:${variantSku}` },
	});
	const { data } = await response.json();
	const edges = data.productVariants?.edges ?? [];
	const exact = edges.find(({ node }) => node.sku === variantSku);
	const node = exact?.node ?? edges[0]?.node;
	return node?.inventoryItem?.id ?? null;
}

/**
 * Wie syncInventoryForVariantWithLogging, ermittelt inventoryItemId jedoch
 * automatisch per SKU-Lookup — kein manuelles Nachschlagen nötig.
 */
export async function syncInventoryBySkuWithLogging(admin, variantSku, options = {}) {
	const startTime = Date.now();
	const groupSku = extractGroupSku(variantSku) ?? "UNKNOWN";
	const { trigger = "manual", orderId = null, orderNumber = null } = options;

	const inventoryItemId = await lookupInventoryItemId(admin, variantSku);

	if (!inventoryItemId) {
		const logData = {
			id: crypto.randomUUID(),
			createdAt: new Date(),
			trigger,
			orderId,
			orderNumber,
			groupSku,
			sourceVariantSku: variantSku,
			inventoryItemId: "unknown",
			success: false,
			quantity: null,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: JSON.stringify([`Keine Variante mit SKU "${variantSku}" gefunden.`]),
			durationMs: Date.now() - startTime,
		};
		await db.syncLog.create({ data: logData });
		return {
			logId: logData.id,
			groupSku,
			sourceVariantSku: variantSku,
			quantity: 0,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: [`Keine Variante mit SKU "${variantSku}" gefunden.`],
		};
	}

	return syncInventoryForVariantWithLogging(admin, variantSku, inventoryItemId, options);
}

// ============================================================================
// Bulk Set mit Logging
// ============================================================================

/**
 * Setzt alle Varianten einer Gruppen-SKU auf eine bestimmte Menge
 * und schreibt das Ergebnis in die Datenbank.
 */
export async function setInventoryForGroupWithLogging(admin, groupSku, quantity, options = {}) {
	const startTime = Date.now();
	const { trigger = "manual:bulk-set" } = options;

	const variants = await findSiblingVariants(admin, groupSku);

	if (variants.length === 0) {
		const logData = {
			id: crypto.randomUUID(),
			createdAt: new Date(),
			trigger,
			orderId: null,
			orderNumber: null,
			groupSku,
			sourceVariantSku: groupSku,
			inventoryItemId: "bulk",
			success: false,
			quantity,
			siblingsFound: 0,
			siblingsUpdated: 0,
			errors: JSON.stringify([`Keine Varianten für Gruppen-SKU "${groupSku}" gefunden.`]),
			durationMs: Date.now() - startTime,
		};
		await db.syncLog.create({ data: logData });
		return {
			logId: logData.id,
			groupSku,
			quantity,
			variantsFound: 0,
			variantsUpdated: 0,
			errors: [`Keine Varianten für Gruppen-SKU "${groupSku}" gefunden.`],
		};
	}

	const errors = [];
	let updated = 0;

	for (const variant of variants) {
		try {
			const level = await getInventoryLevel(admin, variant.inventoryItem.id);
			if (!level || level.error) {
				errors.push(`${variant.sku}: ${level?.error ?? "Kein Lagerort gefunden"}`);
				continue;
			}
			const result = await setInventoryLevel(admin, variant.inventoryItem.id, level.locationId, quantity);
			if (result.success) {
				updated++;
			} else {
				errors.push(`${variant.sku}: ${result.error}`);
			}
			await delay(200);
		} catch (err) {
			errors.push(`${variant.sku}: ${err.message || String(err)}`);
		}
	}

	const success = errors.length === 0;
	const durationMs = Date.now() - startTime;

	console.log(
		`[BulkSet] ${groupSku}: ${updated}/${variants.length} Varianten auf Menge ${quantity} gesetzt` +
			(errors.length > 0 ? ` (${errors.length} Fehler)` : "") +
			` (${durationMs}ms)`
	);

	const logData = {
		id: crypto.randomUUID(),
		createdAt: new Date(),
		trigger,
		orderId: null,
		orderNumber: null,
		groupSku,
		sourceVariantSku: groupSku,
		inventoryItemId: "bulk",
		success,
		quantity,
		siblingsFound: variants.length,
		siblingsUpdated: updated,
		errors: errors.length > 0 ? JSON.stringify(errors) : null,
		durationMs,
	};
	await db.syncLog.create({ data: logData });

	return {
		logId: logData.id,
		groupSku,
		quantity,
		variantsFound: variants.length,
		variantsUpdated: updated,
		errors,
	};
}
