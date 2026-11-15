// Galaxy's queues (Galaxy doc): the Requests queue's seven kinds, the support queue and content reports, each due
// within 24 hours.
// ponytail: counts only; each queue's list and the decisions in it are the next slice.
import { Group, Row } from '../../../account/kit';
import { reports, requests, support } from '../../../galaxy/data';
import { TabPage } from '../../../modeKit';

const count = (q: { count: number; overdue?: number }) => (q.overdue ? `${q.count} · ${q.overdue} overdue` : String(q.count));

export default function Queues() {
  return (
    <TabPage head="Queues">
      <Group title="Requests">
        {requests.map((q) => (
          <Row key={q.label} label={q.label} value={count(q)} />
        ))}
      </Group>
      <Group title="Support">
        {support.map((q) => (
          <Row key={q.label} label={q.label} value={count(q)} />
        ))}
      </Group>
      <Group title="Content reports">
        {reports.map((q) => (
          <Row key={q.label} label={q.label} value={count(q)} />
        ))}
      </Group>
    </TabPage>
  );
}
