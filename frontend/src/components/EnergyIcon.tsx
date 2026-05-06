/**
 * Кристалл энергии (эликсир) — кастомная SVG-иконка вместо emoji.
 * Используется в EnergyBar, в стоимости карт, в HUD профиля.
 */
interface Props {
  size?: number;
  glow?: boolean;
  className?: string;
}

export default function EnergyIcon({ size = 14, glow = false, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ filter: glow ? 'drop-shadow(0 0 4px rgba(176, 143, 255, 0.7))' : undefined }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cr-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dcc4ff" />
          <stop offset="0.5" stopColor="#a07cff" />
          <stop offset="1" stopColor="#5e3cc8" />
        </linearGradient>
      </defs>
      <polygon
        points="8,1 14,6 8,15 2,6"
        fill="url(#cr-grad)"
        stroke="#3d2884"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <polygon points="8,1 14,6 11,6 8,3" fill="#ffffff" opacity="0.45" />
      <polygon points="8,1 5,6 2,6" fill="#000000" opacity="0.18" />
    </svg>
  );
}
