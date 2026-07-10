type LogoMarkProps = {
  className?: string
}

export default function LogoMark({
  className = "h-10 w-10",
}: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="46"
        height="46"
        rx="13"
        fill="#22d3ee"
      />

      <circle
        cx="24"
        cy="24"
        r="11"
        fill="none"
        stroke="#020617"
        strokeWidth="2.5"
      />

      <circle cx="24" cy="24" r="3.5" fill="#020617" />

      <path
        d="M24 7v7M24 34v7M7 24h7M34 24h7"
        stroke="#020617"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
