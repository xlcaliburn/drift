"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h2 className="text-xl font-bold text-bad">Something broke</h2>
      <p className="mt-2 text-sm text-neutral-400">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-ink"
      >
        Try again
      </button>
    </div>
  );
}
