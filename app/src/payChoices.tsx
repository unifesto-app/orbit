// The ways to pay as Account's cards (owner, 19 Nov 2026: Unifesto's pay-method sheet "with orbit's ui"): UPI apps
// (four, then Show more), your UPI IDs (iPhone), a card, a wallet, and Apple Pay on iPhones (coming); no netbanking. The
// pick is the accent dot and stays on this phone (src/session.ts); lists and rules in src/pay.ts. Account › Payment
// methods shows it to set the way you usually pay; at checkout, How to pay (src/app/pay.tsx) shows it and closes on a
// pick or an added UPI ID. Titles only, no descriptions (owner, 15 Nov 2026); a UPI ID's holder name is its value.
import { type ComponentProps, useEffect, useState } from 'react';
import { Alert, Image, type ImageSourcePropType, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Field, Group, Pill, Row, TONE } from './account/kit';
import { installedUpi, phoneIcon } from './checkout';
import { Icon } from './icons';
import { cleanVpa, handleHints, isVpa, vpaApp, type OnPhone, payKey, SHOWN, UPI_APPS, type UpiId, verifyUpiId, WALLETS, type PayWith } from './pay';
import { Chip } from './pickers';
import { Tag } from './rows';
import { addUpiId, removeUpiId, setPayWith, usePayWith, useUpiIds } from './session';
import { color, font, radius } from './theme';

// Each one's real logo (owner, 19 Nov 2026: "just i need real logos"), shipped in the app so it's sharp and offline:
// their App Store icons (Freecharge's and Airtel's from Play, without the "BIZ" and festive lights; Amazon Pay its own
// "pay" mark, not Amazon's shopping box). Brand marks, used only to name the way to pay. Typed by the lists' own ids,
// so tsc stops a new app or wallet going in without its logo.
type LogoId = (typeof UPI_APPS)[number]['id'] | (typeof WALLETS)[number]['code'];
const LOGO: Record<LogoId, ImageSourcePropType> = {
  gpay: require('../assets/pay/gpay.jpg'),
  phonepe: require('../assets/pay/phonepe.jpg'),
  paytm: require('../assets/pay/paytm.jpg'),
  bhim: require('../assets/pay/bhim.jpg'),
  cred: require('../assets/pay/cred.jpg'),
  amazonpay: require('../assets/pay/amazonpay.png'),
  navi: require('../assets/pay/navi.jpg'),
  supermoney: require('../assets/pay/supermoney.jpg'),
  mobikwik: require('../assets/pay/mobikwik.jpg'),
  payzapp: require('../assets/pay/payzapp.jpg'),
  freecharge: require('../assets/pay/freecharge.jpg'),
  airtelmoney: require('../assets/pay/airtelmoney.jpg'),
};

// UPI apps we don't list, by the shortcode Razorpay's iOS SDK reports them under (App Store icons): iOS gives no icons.
const MORE_LOGO: Record<string, ImageSourcePropType> = {
  bobupi: require('../assets/pay/bobupi.jpg'),
  fampay: require('../assets/pay/fampay.jpg'),
  indusmobile: require('../assets/pay/indusmobile.jpg'),
  jupiter: require('../assets/pay/jupiter.jpg'),
  kiwi: require('../assets/pay/kiwi.jpg'),
  kotakbank: require('../assets/pay/kotakbank.jpg'),
  myjio: require('../assets/pay/myjio.jpg'),
  omnicard: require('../assets/pay/omnicard.jpg'),
  popclubapp: require('../assets/pay/popclubapp.jpg'),
  sbiyono: require('../assets/pay/sbiyono.jpg'),
  shriramone: require('../assets/pay/shriramone.jpg'),
  slice: require('../assets/pay/slice.jpg'),
  whatsapp: require('../assets/pay/whatsapp.jpg'),
};

/** Our logo for an app or wallet, else a bundled one for an unlisted iOS app, else the phone's own icon (Android). */
function logoOf(id: string): ImageSourcePropType | undefined {
  if (id in LOGO) return LOGO[id as LogoId];
  if (Object.hasOwn(MORE_LOGO, id)) return MORE_LOGO[id];
  const icon = phoneIcon(id)?.replace(/\s/g, '');
  return icon ? { uri: icon.startsWith('data:') ? icon : `data:image/png;base64,${icon}` } : undefined;
}

/** The way you pay as the pay bar shows it beside "Pay with …" (Unifesto's pay bar, owner 19 Nov 2026: "move paywith to
 * cta"): its logo, Apple Pay's mark, or for a card, a UPI ID or nothing chosen yet, the glyph. */
export function PayMark({ pay }: { pay?: PayWith }) {
  const id = pay?.kind === 'upiApp' ? pay.id : pay?.kind === 'wallet' ? pay.code : pay?.kind === 'vpa' ? vpaApp(pay.vpa) : undefined;
  const logo = id ? logoOf(id) : undefined;
  if (logo) return <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />;
  if (pay?.kind === 'applePay') return <Image source={require('../assets/pay/applepay.png')} style={styles.applePay} resizeMode="contain" accessibilityIgnoresInvertColors />;
  return <Icon name={pay?.kind === 'vpa' ? 'vpa' : pay?.kind === 'card' ? 'card' : pay?.kind === 'upiApp' ? 'upi' : 'wallet'} size={22} color={color.text} />;
}

/** A UPI ID's app logo, by its handle, in the glyph's place; none (so the row keeps its @) for a bank's own handle. */
function vpaLogo(vpa: string) {
  const id = vpaApp(vpa);
  return id && id in LOGO ? <Image source={LOGO[id as LogoId]} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors /> : undefined;
}
// In the field as you type: the app's logo once the handle names one, else the @.
const fieldMark = (vpa: string) => vpaLogo(vpa) ?? <Icon name="vpa" size={22} color={color.secondary} />;

/** A row led by its logo in the glyph's place: 26 wide, the glyph's 22 plus its 4, so labels line up, with the corner
 * a phone gives an app icon. `icon` stays on the element only for Group's hairline indent. */
function PayRow({ id, ...row }: ComponentProps<typeof Row> & { id: string }) {
  const logo = logoOf(id);
  if (!logo) return <Row {...row} />;
  const mark = <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />;
  return <Row {...row} icon={undefined} lead={mark} />;
}

// Adding a UPI ID (owner, 19 Nov 2026: "allow upi id verify and add"): type it, Verify asks Razorpay whose it is, and
// Add keeps it once a name comes back. Editing it after a check asks again. Only what a UPI ID can hold is typed (no
// emoji), and once a name is in, the common @handles sit under the field to finish it (owner, 27 Nov 2026).
type Check = 'idle' | 'checking' | { name: string } | 'invalid' | 'unknown';
function AddUpiId({ onAdded }: { onAdded: (u: UpiId) => void }) {
  const [vpa, setVpa] = useState('');
  const [check, setCheck] = useState<Check>('idle');
  const found = typeof check === 'object' ? check : null;
  const type = (v: string) => {
    setVpa(cleanVpa(v));
    setCheck('idle');
  };
  const hints = found || check === 'checking' ? [] : handleHints(vpa);
  const verify = async () => {
    if (!isVpa(vpa) || check === 'checking') return;
    setCheck('checking');
    setCheck((await verifyUpiId(vpa)) ?? 'unknown');
  };
  const say = found
    ? found.name
      ? `Belongs to ${found.name}`
      : 'Razorpay found this UPI ID'
    : check === 'invalid'
      ? 'No UPI account has this ID'
      : check === 'unknown'
        ? 'Couldn’t check it right now. Try again in a moment.'
        : vpa !== '' && !isVpa(vpa)
          ? 'A UPI ID looks like name@bank'
          : null;
  return (
    <View style={styles.add}>
      <Field
        label="UPI ID"
        lead={fieldMark(vpa)}
        value={vpa}
        onChangeText={type}
        placeholder="name@bank"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        editable={check !== 'checking'}
        keyboardType="email-address"
        returnKeyType="go"
        onSubmitEditing={verify}
        maxLength={256}
      />
      {hints.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.hints}>
          {hints.map((h) => (
            <Chip key={h} label={h.slice(h.indexOf('@'))} onPress={() => type(h)} />
          ))}
        </ScrollView>
      )}
      {say && (
        <Text style={[styles.say, found && styles.found]} accessibilityLiveRegion="polite">
          {say}
        </Text>
      )}
      {found ? (
        <Pill label="Add" size="wide" onPress={() => onAdded({ vpa, name: found.name })} />
      ) : (
        <Pill label={check === 'checking' ? 'Checking…' : 'Verify'} size="wide" disabled={!isVpa(vpa) || check === 'checking'} onPress={verify} />
      )}
    </View>
  );
}

export function PayChoices({ onPicked }: { onPicked?: () => void }) {
  const pick = usePayWith();
  const upiIds = useUpiIds();
  const [allApps, setAllApps] = useState(false);
  const [adding, setAdding] = useState(false);
  // Only the UPI apps this phone has (owner, 27 Nov 2026); every one until Razorpay answers, or if it can't.
  const [onPhone, setOnPhone] = useState<OnPhone[] | null>(null);
  useEffect(() => {
    let live = true;
    installedUpi().then((a) => live && a && setOnPhone(a));
    return () => {
      live = false;
    };
  }, []);
  const choose = (p: PayWith) => {
    setPayWith(p);
    onPicked?.();
  };
  const on = (p: PayWith) => !!pick && payKey(pick) === payKey(p) && (p.kind !== 'vpa' || (pick.kind === 'vpa' && pick.vpa === p.vpa));
  // Tapping a way to pay makes it your default (owner, 19 Nov 2026: "instead of just select, make it default payment
  // method"), the one checkout starts with: that row says so in a grey tag, as event rows tag their status.
  const def = (p: PayWith) => (on(p) ? <Tag text="Default" /> : undefined);
  // A saved UPI ID's Remove, asked first as Remove your photo is (owner, 19 Nov 2026: "add remove for saved upi ids").
  const remove = (u: UpiId) =>
    Alert.alert(`Remove ${u.vpa}?`, 'To pay with it again, you’ll add and verify it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeUpiId(u.vpa) },
    ]);
  const known: readonly { id: string; name: string }[] = onPhone ?? UPI_APPS;
  // The phone's own apps all show, as Zomato does; only our full list (can't tell what's on the phone) folds.
  const folded = !allApps && !onPhone && known.length > SHOWN;
  const apps = folded ? known.slice(0, SHOWN) : known;

  return (
    <>
      <Group title="UPI apps">
        {apps.map((a) => (
          // One we don't list (Kotak811, slice…) keeps the UPI glyph and its name, which Pay with shows too.
          <PayRow key={a.id} id={a.id} icon="upi" label={a.name} right={def({ kind: 'upiApp', id: a.id })} onPress={() => choose({ kind: 'upiApp', id: a.id, name: a.name })} />
        ))}
        {/* None of ours on this phone: plain UPI too, which opens checkout on UPI to pick an app there. */}
        {!known.some((a) => UPI_APPS.some((u) => u.id === a.id)) && <Row icon="upi" label="UPI" right={def({ kind: 'upiApp', id: 'upi' })} onPress={() => choose({ kind: 'upiApp', id: 'upi' })} />}
        {folded && <Row label={`Show ${known.length - SHOWN} more UPI apps`} chevron onPress={() => setAllApps(true)} />}
      </Group>

      {/* Paying to a typed UPI ID is iPhone-only: NPCI ended it on 28 Feb 2026 except in iOS apps and mobile web
          (Unifesto's CAN_TYPE_UPI_ID); Android pays through the UPI apps above. */}
      {Platform.OS === 'ios' && (
        <Group title="UPI ID">
          {upiIds.map((u) => (
            <Row
              key={u.vpa}
              icon="vpa"
              tone={TONE.cyan}
              lead={vpaLogo(u.vpa)}
              label={u.vpa}
              note={u.name || undefined}
              right={
                <>
                  {def({ kind: 'vpa', vpa: u.vpa })}
                  <Pill label="Remove" size="small" onPress={() => remove(u)} />
                </>
              }
              onPress={() => choose({ kind: 'vpa', vpa: u.vpa })}
            />
          ))}
          {adding ? (
            <AddUpiId
              onAdded={(u) => {
                addUpiId(u);
                setAdding(false);
                onPicked?.();
              }}
            />
          ) : (
            <Row icon="vpa" tone={TONE.cyan} label={upiIds.length ? 'Add another UPI ID' : 'Add a UPI ID'} chevron onPress={() => setAdding(true)} />
          )}
        </Group>
      )}

      <Group title="Card">
        <Row icon="card" tone={TONE.mint} label="Credit or debit card" right={def({ kind: 'card' })} onPress={() => choose({ kind: 'card' })} />
      </Group>

      <Group title="Wallets">
        {WALLETS.map((w) => (
          <PayRow key={w.code} id={w.code} icon="wallet" label={w.name} right={def({ kind: 'wallet', code: w.code })} onPress={() => choose({ kind: 'wallet', code: w.code })} />
        ))}
      </Group>

      {/* Apple's own Apple Pay mark, as downloaded (developer.apple.com/apple-pay/marketing): its HIG says that once
          other ways to pay show logos it must be this artwork, unaltered and no shorter than them. Listed as coming
          until checkout takes it. */}
      {Platform.OS === 'ios' && (
        <Group title="Apple Pay">
          <Row lead={<Image source={require('../assets/pay/applepay.png')} style={styles.applePay} resizeMode="contain" accessibilityIgnoresInvertColors />} label="Apple Pay" value="Coming soon" />
        </Group>
      )}
    </>
  );
}

// A bundled image takes its file's size unless the style gives both sides, so the Apple Pay mark gets both: as tall as
// the other logos (its HIG's floor), as wide as its own artwork's proportions (the SVG's 165.52 x 105.97).
const MARK = 26;
const styles = StyleSheet.create({
  logo: { width: MARK, height: MARK, borderRadius: radius.sm },
  applePay: { width: Math.round((MARK * 165.52107) / 105.9651), height: MARK },
  add: { gap: 8 },
  hints: { gap: 8 },
  say: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  found: { color: color.text },
});
