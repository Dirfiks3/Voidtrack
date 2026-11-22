interface ProgressRingProps {
  percent: number;
}

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ProgressRing({ percent }: ProgressRingProps) {
  const value = Math.max(0, Math.min(100, percent));

  return (
    <svg className="progress-ring" viewBox="0 0 120 120" aria-hidden>
      <circle className="progress-ring-track" cx="60" cy="60" r={RADIUS} />
      <circle
        className="progress-ring-value"
        cx="60"
        cy="60"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
        transform="rotate(-90 60 60)"
      />
    </svg>
  );
}
