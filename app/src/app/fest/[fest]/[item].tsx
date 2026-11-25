// One thing inside a fest (owner, 19 Nov 2026: "Events inside fests"): a competition, a performance, a workshop or the
// food, from the fest page's Inside the fest. A sheet over the fest: when and where, what it is, a competition's team
// size and prize, and the act on stage, whose page it opens. It comes with the fest's own booking: no ticket of its own.
// Since 19 Nov 2026 (owner approved Take 3 of the detail pages mockup) the act is a host row with Follow under On stage,
// as Hosted by on the event page, rather than a fact in the card.
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fact, FactCard } from '../../../fact';
import { festItems } from '../../../kinds';
import { events, hosts } from '../../../mock';
import { FollowRow, NotFound, Section, Sheet } from '../../../rows';
import { color, font, space } from '../../../theme';

export default function FestItem() {
  const { fest, item } = useLocalSearchParams<{ fest: string; item: string }>();
  const e = events.find((x) => x.id === fest);
  const it = festItems[fest]?.find((x) => x.id === item);
  if (!e || !it) return <NotFound what="part of a fest" />;
  const act = it.act ? hosts.find((h) => h.id === it.act) : undefined;
  return (
    <Sheet title={it.title} note={`${it.kind} · ${e.title}`} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        <Text style={styles.about}>{it.about}</Text>
        <FactCard flush>
          <Fact label="When" value={`${it.when}, ${e.when.split(' · ')[0]}`} />
          <Fact label="Where" value={it.where} note={e.venue.name} />
          {it.team && <Fact label="Teams" value={it.team} />}
          {it.prize && <Fact label="Prize" value={it.prize} />}
          <Fact label="Entry" value={`Included with ${e.title}`} />
        </FactCard>
        {act && (
          <View>
            <View style={styles.flush}>
              <Section top={0} title="On stage" />
            </View>
            {/* Closes this sheet on the way, as the person sheet does, so the act's page doesn't open under it. */}
            <FollowRow host={act} line={act.about} onPress={() => router.dismissTo(`/host/${act.slug}`)} />
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  flush: { marginHorizontal: -20 }, // a Section heading brings the page's margin, which the sheet already has
  about: { fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
});
