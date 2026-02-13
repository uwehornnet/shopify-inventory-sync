import Image from "next/image";

export default function Home() {
	return (
		<main
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				height: "100vh",
			}}
		>
			<Image src="/logo.svg" alt="Schaltauge logo" width={400} height={200} priority />
		</main>
	);
}
