import { role } from '@orbit/tokens';
import * as Application from 'expo-application';
import { StyleSheet, Text, View } from 'react-native';
import { variants } from '../../variants';

// The native bundle id picks the screen: one Metro serves all three apps' JS, so Constants/expoConfig would be
// whichever variant Metro started with.
const v = Object.values(variants).find((x) => x.id === Application.applicationId);

export default function Index() {
  return (
    <View style={s.root}>
      {v ? (
        <>
          <Text style={s.word}>{v.word}</Text>
          <Text style={s.name}>{v.name}</Text>
          <Text style={s.line}>{v.line}</Text>
        </>
      ) : (
        <Text style={s.name}>{Application.applicationId}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: role.ground, padding: 24 },
  word: { fontFamily: 'Sacramento_400Regular', fontSize: 88, color: role.text },
  name: { fontSize: 20, color: role.text, marginTop: 4 },
  line: { fontSize: 15, color: role.text2, marginTop: 8, textAlign: 'center' },
});
