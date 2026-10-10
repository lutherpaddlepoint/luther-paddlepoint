import { formatMinute } from "@/lib/time";

const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Hour picker that submits "HH:MM". */
export default function HourSelect(props: { name: string; from: number; to: number; defaultMinute?: number; className?: string }) {
  const opts: number[] = [];
  for (let m = props.from; m <= props.to; m += 60) opts.push(m);
  return (
    <select name={props.name} defaultValue={props.defaultMinute != null ? pad(props.defaultMinute) : undefined} className={props.className}>
      {opts.map((m) => (
        <option key={m} value={pad(m)}>{formatMinute(m)}</option>
      ))}
    </select>
  );
}
