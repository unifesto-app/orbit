// The agenda, from When on the event page (owner, 15 Nov 2026: "When clicked for Agenda ( Modal )", then "Agenda full
// modal"): a full modal like the person sheet, its title over the date and time in India time, then every slot in
// order. It scrolls when there are many. When is tappable only on an event with an agenda.
// Since 19 Nov 2026 (owner approved Take 3 of the detail pages mockup) the slots are one outlined card, each time over
// its slot, as the fest's Inside the fest card on the event page.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { Fact, FactCard } from '../../fact';
import { events } from '../../mock';
import { NotFound, Sheet } from '../../rows';

export default function AgendaSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  if (!e) return <NotFound what="event" />;
  return (
    <Sheet title="Agenda" note={`${e.when} IST`} full>
      <ScrollView showsVerticalScrollIndicator={false}>
        <FactCard flush>
          {(e.agenda ?? []).map((a) => (
            <Fact key={`${a.time} ${a.item}`} label={a.time} value={a.item} />
          ))}
        </FactCard>
      </ScrollView>
    </Sheet>
  );
}
