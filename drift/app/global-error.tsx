"use client";

// Root error boundary — replaces the layout, so it must render <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#0b0e14",
          color: "#dfe4ee",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 520, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#d9584a" }}>Something broke</h2>
          <p style={{ marginTop: 8, fontSize: 14, color: "#9aa3b2" }}>
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              borderRadius: 6,
              background: "#e8a33d",
              color: "#0b0e14",
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
