interface StaticWeekProps {
  week: boolean[];
  todayIndex: number;
}

export default function StaticWeek({ week, todayIndex }: StaticWeekProps) {
  return (
    <div className="week-fallback" aria-hidden>
      {week.map((done, index) => (
        <i
          key={index}
          className={`${done ? "done" : ""} ${index === todayIndex ? "today" : ""}`.trim()}
        />
      ))}
    </div>
  );
}
