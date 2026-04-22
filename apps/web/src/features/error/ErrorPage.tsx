import { useRouteError } from "react-router-dom";

export function ErrorPage() {
	const error = useRouteError();
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "An unexpected error occurred.";

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
			<h1 className="text-2xl font-semibold tracking-tight">
				Something went wrong
			</h1>
			<p className="max-w-md text-sm text-muted-foreground">{message}</p>
			<a href="/" className="text-sm underline underline-offset-4">
				Back to home
			</a>
		</div>
	);
}
