import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

const router = createBrowserRouter(routes);
const queryClient = new QueryClient({
	defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider delayDuration={150}>
				<RouterProvider router={router} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}
