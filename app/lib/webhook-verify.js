import { createHmac } from "crypto";

export function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
	if (!hmacHeader) return false;

	const hash = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

	if (hash.length !== hmacHeader.length) return false;

	let result = 0;
	for (let i = 0; i < hash.length; i++) {
		result |= hash.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
	}

	return result === 0;
}
