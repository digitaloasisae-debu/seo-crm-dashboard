"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card border-red-200">
      <h2 className="mb-2 font-semibold text-red-700">That didn&apos;t work</h2>
      <p className="mb-4 text-sm text-slate-700">{error.message}</p>
      <button className="btn-secondary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
