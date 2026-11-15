// Console's Money tab (Money flow, Sales and Bank account and payouts). Only Admins and Curators touch money: an Admin
// sees the host's six numbers, every event's and the bank account; a Curator only their own events; anyone else a line
// saying so (src/modes.ts). Payouts open 3 days after an event's scheduled end; Admins and Curators ask for them.
// ponytail: Request does nothing yet; payouts and refunds are a later slice.
import { Group, Pill, Row } from '../../../account/kit';
import { day } from '../../../account/rules';
import { banks, salesOf, useHost } from '../../../console/data';
import { type Sales, available, earnings, payoutOpens, rupees } from '../../../console/money';
import { Empty, TabPage } from '../../../modeKit';
import { eventsOn, seesEventMoney, seesHostMoney } from '../../../modes';
import { now } from '../../../mock';

const sum = (all: Sales[], f: (s: Sales) => number) => rupees(all.reduce((n, s) => n + f(s), 0));

export default function Money() {
  const { team, events } = useHost();
  const money = eventsOn(team, events).filter((e) => seesEventMoney(team, e.id));
  if (money.length === 0 && !seesHostMoney(team))
    return (
      <TabPage head="Money">
        <Empty>Only Admins and Curators see money.</Empty>
      </TabPage>
    );
  const mine = money.flatMap((e) => {
    const s = salesOf(e.id);
    return s ? [{ e, s }] : [];
  });
  const all = mine.map((m) => m.s);
  const bank = seesHostMoney(team) ? banks[team.hostId] : undefined;
  return (
    <TabPage head="Money">
      {mine.length === 0 && <Empty>No sales yet.</Empty>}
      {seesHostMoney(team) && mine.length > 0 && (
        <Group title="All events">
          <Row label="Ticket sales" value={sum(all, (s) => s.salesPaise)} />
          <Row label={all.every((s) => s.feeBy === 'buyers') ? 'Fees, paid by buyers' : 'Fees'} value={sum(all, (s) => s.feesPaise)} />
          <Row label="Refunded" value={sum(all, (s) => s.refundedPaise)} />
          <Row label="Your earnings" value={sum(all, earnings)} />
          <Row label="Paid out" value={sum(all, (s) => s.paidOutPaise)} />
          <Row label="Available" value={sum(all, available)} />
        </Group>
      )}
      {mine.map(({ e, s }) => {
        const open = payoutOpens(s) <= now;
        const free = available(s);
        return (
          <Group key={e.id} title={`${e.title} · ${day(e.startsAt)}`}>
            <Row label="Ticket sales" value={rupees(s.salesPaise)} />
            <Row label="Your earnings" value={rupees(earnings(s))} />
            <Row
              label="Payout"
              value={open ? (free > 0 ? undefined : 'Nothing to pay out') : `Opens ${day(payoutOpens(s))}`}
              right={open && free > 0 ? <Pill label={`Request ${rupees(free)}`} size="small" /> : undefined}
            />
          </Group>
        );
      })}
      {seesHostMoney(team) && (
        <Group title="Bank account">
          {bank ? <Row label={`•••• ${bank.last4}`} value={bank.status} /> : <Row label="Add where you get paid" />}
        </Group>
      )}
    </TabPage>
  );
}
