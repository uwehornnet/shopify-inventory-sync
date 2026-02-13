import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }) {
	const params = await searchParams;
	const search = params.search || "";
	const page = parseInt(params.page || "1", 10);
	const limit = 50;
	const offset = (page - 1) * limit;

	const where = search ? { sku: { contains: search.toUpperCase() } } : {};

	const [stats, groups, totalGroups, totalVariants, recentLogs] = await Promise.all([
		// Stats
		Promise.all([
			prisma.inventoryGroup.count(),
			prisma.productVariant.count(),
			prisma.inventoryGroup.count({ where: { quantity: 0 } }),
			prisma.syncLog.count({
				where: {
					createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
				},
			}),
			prisma.syncLog.count({
				where: {
					error: { not: null },
					createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
				},
			}),
		]),
		// Groups
		prisma.inventoryGroup.findMany({
			where,
			include: {
				_count: { select: { variants: true } },
			},
			orderBy: { sku: "asc" },
			skip: offset,
			take: limit,
		}),
		prisma.inventoryGroup.count({ where }),
		prisma.productVariant.count(),
		// Recent logs
		prisma.syncLog.findMany({
			orderBy: { createdAt: "desc" },
			take: 20,
		}),
	]);

	const [groupCount, variantCount, outOfStock, syncsToday, errorsToday] = stats;
	const totalPages = Math.ceil(totalGroups / limit);

	return (
		<div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
			<h1 style={{ fontSize: 24, marginBottom: 8 }}>🔧 Schaltauge24 Inventory Sync</h1>
			<p style={{ color: "#666", marginBottom: 24 }}>
				Bestandssynchronisierung für {variantCount} Varianten in {groupCount} Gruppen
			</p>

			{/* Stats Cards */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					gap: 16,
					marginBottom: 32,
				}}
			>
				<StatCard label="Inventory Groups" value={groupCount} />
				<StatCard label="Varianten" value={variantCount} />
				<StatCard label="Nicht auf Lager" value={outOfStock} alert={outOfStock > 0} />
				<StatCard label="Syncs (24h)" value={syncsToday} />
				<StatCard label="Fehler (24h)" value={errorsToday} alert={errorsToday > 0} />
			</div>

			{/* Search */}
			<div style={{ marginBottom: 24 }}>
				<form method="GET" style={{ display: "flex", gap: 8 }}>
					<input
						name="search"
						type="text"
						placeholder="SKU suchen (z.B. BXAAA)..."
						defaultValue={search}
						style={{
							padding: "8px 12px",
							border: "1px solid #ddd",
							borderRadius: 6,
							fontSize: 14,
							width: 300,
						}}
					/>
					<button
						type="submit"
						style={{
							padding: "8px 16px",
							background: "#333",
							color: "#fff",
							border: "none",
							borderRadius: 6,
							cursor: "pointer",
						}}
					>
						Suchen
					</button>
					{search && (
						<Link
							href="/"
							style={{
								padding: "8px 16px",
								textDecoration: "none",
								color: "#666",
							}}
						>
							Zurücksetzen
						</Link>
					)}
				</form>
			</div>

			{/* Groups Table */}
			<div
				style={{
					background: "#fff",
					borderRadius: 8,
					border: "1px solid #e0e0e0",
					overflow: "hidden",
					marginBottom: 32,
				}}
			>
				<table
					style={{
						width: "100%",
						borderCollapse: "collapse",
						fontSize: 14,
					}}
				>
					<thead>
						<tr style={{ background: "#f9f9f9", borderBottom: "1px solid #e0e0e0" }}>
							<th style={th}>SKU</th>
							<th style={th}>Bestand</th>
							<th style={th}>Varianten</th>
							<th style={th}>Aktualisiert</th>
						</tr>
					</thead>
					<tbody>
						{groups.map((g) => (
							<tr key={g.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
								<td style={td}>
									<strong>{g.sku}</strong>
								</td>
								<td style={td}>
									<span
										style={{
											padding: "2px 8px",
											borderRadius: 12,
											fontSize: 13,
											fontWeight: 600,
											background: g.quantity === 0 ? "#fee2e2" : "#dcfce7",
											color: g.quantity === 0 ? "#dc2626" : "#16a34a",
										}}
									>
										{g.quantity}
									</span>
								</td>
								<td style={td}>{g._count.variants}</td>
								<td style={{ ...td, color: "#888", fontSize: 13 }}>
									{g.updatedAt.toLocaleString("de-DE")}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
					{page > 1 && (
						<a href={`?search=${search}&page=${page - 1}`} style={pageLink}>
							← Zurück
						</a>
					)}
					<span style={{ padding: "6px 12px", color: "#666" }}>
						Seite {page} von {totalPages}
					</span>
					{page < totalPages && (
						<a href={`?search=${search}&page=${page + 1}`} style={pageLink}>
							Weiter →
						</a>
					)}
				</div>
			)}

			{/* Recent Sync Logs */}
			<h2 style={{ fontSize: 18, marginBottom: 12 }}>📋 Letzte Sync-Aktionen</h2>
			<div
				style={{
					background: "#fff",
					borderRadius: 8,
					border: "1px solid #e0e0e0",
					overflow: "hidden",
				}}
			>
				<table
					style={{
						width: "100%",
						borderCollapse: "collapse",
						fontSize: 13,
					}}
				>
					<thead>
						<tr style={{ background: "#f9f9f9", borderBottom: "1px solid #e0e0e0" }}>
							<th style={th}>Zeit</th>
							<th style={th}>Gruppe</th>
							<th style={th}>Trigger</th>
							<th style={th}>Alt → Neu</th>
							<th style={th}>Varianten</th>
							<th style={th}>Status</th>
						</tr>
					</thead>
					<tbody>
						{recentLogs.map((log) => (
							<tr key={log.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
								<td style={{ ...td, fontSize: 12, color: "#888" }}>
									{log.createdAt.toLocaleString("de-DE")}
								</td>
								<td style={td}>
									<strong>{log.groupSku}</strong>
								</td>
								<td style={td}>
									<TriggerBadge trigger={log.trigger} />
								</td>
								<td style={td}>
									{log.oldQuantity} → {log.newQuantity}
								</td>
								<td style={td}>{log.variantsUpdated}</td>
								<td style={td}>
									{log.error ? (
										<span style={{ color: "#dc2626" }}>⚠️ Fehler</span>
									) : (
										<span style={{ color: "#16a34a" }}>✅</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ============================================================================
// Components
// ============================================================================

function StatCard({ label, value, alert = false }) {
	return (
		<div
			style={{
				background: alert ? "#fef2f2" : "#fff",
				border: `1px solid ${alert ? "#fecaca" : "#e0e0e0"}`,
				borderRadius: 8,
				padding: 16,
			}}
		>
			<div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
			<div
				style={{
					fontSize: 28,
					fontWeight: 700,
					color: alert ? "#dc2626" : "#111",
				}}
			>
				{value.toLocaleString("de-DE")}
			</div>
		</div>
	);
}

function TriggerBadge({ trigger }) {
	const colors = {
		ORDER: { bg: "#dbeafe", fg: "#1d4ed8" },
		REFUND: { bg: "#fef3c7", fg: "#b45309" },
		MANUAL: { bg: "#e0e7ff", fg: "#4338ca" },
		CRON: { bg: "#f3f4f6", fg: "#374151" },
		INIT: { bg: "#d1fae5", fg: "#065f46" },
		INVENTORY_UPDATE: { bg: "#fce7f3", fg: "#be185d" },
	};

	const c = colors[trigger] || { bg: "#f3f4f6", fg: "#333" };

	return (
		<span
			style={{
				padding: "2px 8px",
				borderRadius: 12,
				fontSize: 11,
				fontWeight: 600,
				background: c.bg,
				color: c.fg,
			}}
		>
			{trigger}
		</span>
	);
}

// ============================================================================
// Styles
// ============================================================================

const th = {
	textAlign: "left",
	padding: "10px 14px",
	fontSize: 12,
	fontWeight: 600,
	color: "#666",
	textTransform: "uppercase",
	letterSpacing: "0.5px",
};

const td = {
	padding: "10px 14px",
};

const pageLink = {
	padding: "6px 14px",
	background: "#fff",
	border: "1px solid #ddd",
	borderRadius: 6,
	textDecoration: "none",
	color: "#333",
	fontSize: 14,
};
