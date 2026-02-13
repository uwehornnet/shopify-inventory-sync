/**
 * Extrahiert die Gruppen-SKU aus einer Varianten-SKU.
 *
 * "BXAAA-1"      → "BXAAA"
 * "BXAAD-18"     → "BXAAD"
 * "XXXXX-160-1"  → "XXXXX-160"
 *
 * Regel: Alles vor dem letzten Bindestrich.
 */
export function extractGroupSku(variantSku) {
	if (!variantSku || typeof variantSku !== "string") return null;

	const trimmed = variantSku.trim().toUpperCase();
	const lastDash = trimmed.lastIndexOf("-");

	if (lastDash <= 0) return null;

	const afterDash = trimmed.substring(lastDash + 1);
	if (!/^\d+$/.test(afterDash)) return null;

	return trimmed.substring(0, lastDash);
}
