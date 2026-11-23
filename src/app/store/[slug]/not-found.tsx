export default function StoreNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center text-fg">
      <p className="text-sm text-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">This store isn’t available</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The link may be wrong, or the business hasn’t published its store yet.</p>
    </main>
  );
}
