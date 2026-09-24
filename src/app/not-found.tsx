import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card empty">
      <p>Diese Seite gibt es nicht.</p>
      <Link href="/">Zur Übersicht</Link>
    </div>
  );
}
