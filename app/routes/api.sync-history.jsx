import db from "~/db.server";

/**
 * API-Route: Sync-History abrufen
 *
 * Gibt die letzten Sync-Logs zurück, mit Filterung und Pagination.
 *
 * Query-Parameter:
 *   - limit: Anzahl der Logs (default: 50, max: 200)
 *   - offset: Offset für Pagination (default: 0)
 *   - groupSku: Filter nach Gruppen-SKU
 *   - success: Filter nach Erfolg (true/false)
 *   - since: Filter nach Datum (ISO 8601)
 *
 * Beispiele:
 *   GET /api/sync-history
 *   GET /api/sync-history?limit=10
 *   GET /api/sync-history?groupSku=BXAAA
 *   GET /api/sync-history?success=false
 *   GET /api/sync-history?since=2026-02-01T00:00:00Z
 */
export async function loader({ request }) {
	const url = new URL(request.url);

	// Query-Parameter parsen
	const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
	const offset = parseInt(url.searchParams.get("offset") || "0");
	const groupSku = url.searchParams.get("groupSku");
	const successParam = url.searchParams.get("success");
	const since = url.searchParams.get("since");

	// Filter-Objekt bauen
	const where = {};

	if (groupSku) {
		where.groupSku = groupSku;
	}

	if (successParam !== null) {
		where.success = successParam === "true";
	}

	if (since) {
		try {
			where.createdAt = {
				gte: new Date(since),
			};
		} catch (error) {
			return Response.json(
				{
					error: "Invalid 'since' date format. Use ISO 8601 (e.g., 2026-02-01T00:00:00Z)",
				},
				{ status: 400 }
			);
		}
	}

	try {
		// Logs abrufen
		const logs = await db.syncLog.findMany({
			where,
			orderBy: {
				createdAt: "desc",
			},
			take: limit,
			skip: offset,
		});

		// Gesamt-Anzahl für Pagination
		const total = await db.syncLog.count({ where });

		// Errors von JSON-String zurück zu Array parsen
		const formattedLogs = logs.map((log) => ({
			...log,
			errors: log.errors ? JSON.parse(log.errors) : [],
		}));

		// Statistiken berechnen
		const stats = {
			total,
			returned: logs.length,
			hasMore: offset + logs.length < total,
			successRate:
				total > 0
					? ((await db.syncLog.count({ where: { ...where, success: true } })) / total) * 100
					: 0,
		};

		return Response.json({
			success: true,
			logs: formattedLogs,
			stats,
			pagination: {
				limit,
				offset,
				nextOffset: offset + limit,
			},
		});
	} catch (error) {
		console.error("[API] sync-history error:", error);

		return Response.json(
			{
				success: false,
				error: error.message || "Failed to fetch sync history",
			},
			{ status: 500 }
		);
	}
}
