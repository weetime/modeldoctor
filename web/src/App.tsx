export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <h1 className="text-2xl font-semibold tracking-tight">ModelDoctor</h1>
      <p className="text-sm text-muted-foreground mt-2">Tailwind token check.</p>
      <button
        type="button"
        className="mt-4 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        onClick={() => document.documentElement.classList.toggle("dark")}
      >
        Toggle dark
      </button>
    </div>
  );
}
