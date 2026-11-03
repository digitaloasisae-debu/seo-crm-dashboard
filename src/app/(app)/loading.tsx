export default function Loading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-2 h-8 w-64" />
      <div className="skeleton mb-8 h-4 w-96 max-w-full" />
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
      </div>
      <div className="skeleton h-72 rounded-2xl" />
    </div>
  );
}
