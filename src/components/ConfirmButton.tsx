"use client";

/** Absende-Button mit Sicherheitsabfrage. */
export function ConfirmButton({
  children,
  message,
  className = "btn danger",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
