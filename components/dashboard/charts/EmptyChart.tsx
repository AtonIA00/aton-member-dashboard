type Props = {
  message: string;
  height?: number;
};

export function EmptyChart({ message, height = 250 }: Props) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-[color:var(--border)] bg-white/[0.02]"
      style={{ height }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[color:var(--muted-foreground)]/60"
          aria-hidden
        >
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 5-5" />
        </svg>
        <span className="text-xs text-[color:var(--muted-foreground)]">
          {message}
        </span>
      </div>
    </div>
  );
}
