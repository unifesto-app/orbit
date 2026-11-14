import { StyleSheet, Text, View } from 'react-native';

import { color } from '../theme';

// Placeholder until the Home header pick (plan question 14) lands.
export default function Home() {
  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>ORBIT</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ground,
  },
  wordmark: {
    color: color.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 6,
  },
});
