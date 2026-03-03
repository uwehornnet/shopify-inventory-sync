const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

const GRAPHQL_URL = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

export async function shopifyGraphQL(query, variables) {
	const response = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
		},
		body: JSON.stringify({ query, variables }),
	});

	if (response.status === 429) {
		const retryAfter = parseFloat(response.headers.get("Retry-After") || "2");
		console.log(`[Shopify] Rate limited, waiting ${retryAfter}s...`);
		await delay(retryAfter * 1000);
		return shopifyGraphQL(query, variables);
	}

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Shopify API ${response.status}: ${text}`);
	}

	const result = await response.json();

	if (result.errors?.length) {
		const throttled = result.errors.some((e) => e.message.toLowerCase().includes("throttled"));
		if (throttled) {
			console.log("[Shopify] Throttled, waiting 2s...");
			await delay(2000);
			return shopifyGraphQL(query, variables);
		}
		throw new Error(`Shopify GraphQL: ${result.errors.map((e) => e.message).join(", ")}`);
	}

	return result.data;
}

export function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
