/** Re-mounts on every client page change, so each page glides in. */
export default function ClientTemplate({ children }: { children: React.ReactNode }) {
  return <div className="rf-page-in">{children}</div>;
}
