import path from "node:path";
import { openDb, migrate, getLatestPulse, getPulseItems, listPulses } from "@/lib/pulse/db";
import { PulseShell } from "@/components/pulse/PulseShell";
import { PulseHeader } from "@/components/pulse/PulseHeader";
import { HistoryList } from "@/components/pulse/HistoryList";
import { PulseFeed } from "@/components/pulse/PulseFeed";

export const dynamic = "force-dynamic";

export default async function PulsePage() {
  const db = openDb(path.resolve(process.cwd(), "data", "pulse.db"));
  migrate(db);
  const pulse = getLatestPulse(db);
  const items = pulse ? getPulseItems(db, pulse.id) : [];
  const history = listPulses(db, 30).map((p) => ({
    id: p.id,
    date_key: p.date_key,
    item_count: p.item_count,
    generated_at: p.generated_at,
    status: p.status,
  }));
  db.close();

  return (
    <PulseShell
      header={<PulseHeader pulse={pulse} />}
      sidebar={<HistoryList entries={history} activeId={pulse?.id ?? null} />}
    >
      <PulseFeed initialItems={items} />
    </PulseShell>
  );
}
