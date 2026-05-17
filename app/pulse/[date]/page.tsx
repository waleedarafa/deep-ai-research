import path from "node:path";
import { notFound } from "next/navigation";
import { openDb, migrate, getPulseByDate, getPulseItems, listPulses } from "@/lib/pulse/db";
import { PulseShell } from "@/components/pulse/PulseShell";
import { PulseHeader } from "@/components/pulse/PulseHeader";
import { TopicFilter } from "@/components/pulse/TopicFilter";
import { HistoryList } from "@/components/pulse/HistoryList";
import { PulseFeed } from "@/components/pulse/PulseFeed";

export const dynamic = "force-dynamic";

export default async function PulseDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const db = openDb(path.resolve(process.cwd(), "data", "pulse.db"));
  migrate(db);
  const pulse = getPulseByDate(db, date);
  if (!pulse) {
    db.close();
    notFound();
  }
  const items = getPulseItems(db, pulse.id);
  const history = listPulses(db, 30).map((p) => ({
    id: p.id,
    date_key: p.date_key,
    item_count: p.item_count,
    generated_at: p.generated_at,
    status: p.status,
  }));
  db.close();
  const allTopics = Array.from(new Set(items.flatMap((i) => i.topics)));

  return (
    <PulseShell
      header={<PulseHeader pulse={pulse} />}
      sidebar={
        <>
          <TopicFilter topics={allTopics} items={items} />
          <HistoryList entries={history} activeId={pulse.id} />
        </>
      }
    >
      <PulseFeed initialItems={items} />
    </PulseShell>
  );
}
