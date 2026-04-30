// Stylized 8-point sparkle/asterisk reminiscent of the Claude/Anthropic mark.
export function ClaudeMark({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 2 C12.4 6.6 13.2 8 17.4 8.6 C21.4 9 22 9.6 22 12 C22 14.4 21.4 15 17.4 15.4 C13.2 16 12.4 17.4 12 22 C11.6 17.4 10.8 16 6.6 15.4 C2.6 15 2 14.4 2 12 C2 9.6 2.6 9 6.6 8.6 C10.8 8 11.6 6.6 12 2 Z"
        fill="currentColor"
      />
    </svg>
  );
}
