/**
 * Registriert den orders/paid Webhook bei Shopify.
 *
 * Ausführen: node scripts/register-webhooks.js
 *
 * Vorher .env.local laden, z.B. mit dotenv:
 *   node -r dotenv/config scripts/register-webhooks.js
 *
 * Oder manuell die ENV-Variablen setzen.
 */

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";
const APP_URL = process.env.APP_URL;

const GRAPHQL_URL = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

async function graphql(query, variables) {
	const res = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
		},
		body: JSON.stringify({ query, variables }),
	});
	const json = await res.json();
	if (json.errors) throw new Error(JSON.stringify(json.errors));
	return json.data;
}

async function main() {
	console.log(`Store: ${SHOPIFY_STORE_DOMAIN}`);
	console.log(`App URL: ${APP_URL}`);
	console.log();

	// Bestehende Webhooks auflisten
	const existing = await graphql(`
		query {
			webhookSubscriptions(first: 25) {
				edges {
					node {
						id
						topic
						endpoint {
							... on WebhookHttpEndpoint {
								callbackUrl
							}
						}
					}
				}
			}
		}
	`);

	console.log("Existing webhooks:");
	for (const { node } of existing.webhookSubscriptions.edges) {
		console.log(`  ${node.topic} → ${node.endpoint.callbackUrl}`);
	}

	// Alte Webhooks für unsere URL löschen
	for (const { node } of existing.webhookSubscriptions.edges) {
		if (node.endpoint.callbackUrl.startsWith(APP_URL)) {
			console.log(`Removing: ${node.topic} (${node.id})`);
			await graphql(
				`
					mutation del($id: ID!) {
						webhookSubscriptionDelete(id: $id) {
							deletedWebhookSubscriptionId
							userErrors {
								message
							}
						}
					}
				`,
				{ id: node.id },
			);
		}
	}

	// orders/paid Webhook registrieren
	const callbackUrl = `${APP_URL}/api/webhooks/orders-paid`;
	console.log(`\nRegistering: ORDERS_PAID → ${callbackUrl}`);

	const result = await graphql(
		`
			mutation create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
				webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
					webhookSubscription {
						id
					}
					userErrors {
						field
						message
					}
				}
			}
		`,
		{
			topic: "ORDERS_PAID",
			sub: { callbackUrl, format: "JSON" },
		},
	);

	if (result.webhookSubscriptionCreate.userErrors.length > 0) {
		console.error("Error:", result.webhookSubscriptionCreate.userErrors);
	} else {
		console.log(`✅ Created: ${result.webhookSubscriptionCreate.webhookSubscription?.id}`);
	}
}

main().catch(console.error);
