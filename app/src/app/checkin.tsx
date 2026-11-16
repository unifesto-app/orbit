// Check-in, the hosts' third card in the switcher (owner, 16 Nov 2026: "Host approved", then "dont use the name Door",
// "use Checkin"): every event the viewer works on whose check-in is open, each with how many are in, Scan and Find someone (Event day doc: from 24
// hours before the start until check-in closes, 3 hours after the end). Anyone on an event's team scans: Admins,
// Curators, Co-curators and Crew. Back goes to Home, under it.
import { Page } from '../account/kit';
import { DoorCard } from '../console/DoorCard';
import { endsAt, salesOf } from '../console/data';
import { Empty } from '../modeKit';
import { events, hosts, now } from '../mock';
import { eventsOn, onEventDay } from '../modes';
import { useMe } from '../session';

export default function CheckIn() {
  const me = useMe(); // signed out, on no team
  const open = me.teams
    .flatMap((t) => eventsOn(t, events))
    .filter((e) => onEventDay(e.startsAt, endsAt(e), now));
  return (
    <Page title="Check-in">
      {open.length === 0 ? (
        <Empty>No event today.</Empty>
      ) : (
        open.map((e) => {
          const s = salesOf(e.id);
          return <DoorCard key={e.id} heading={hosts.find((h) => h.id === e.hostId)?.name ?? ''} title={e.title} when={e.when} checkedIn={s?.checkedIn ?? 0} booked={s?.booked ?? 0} />;
        })
      )}
    </Page>
  );
}
