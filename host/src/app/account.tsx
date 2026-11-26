// Account, in every host app (App Store 5.1.1(v): an account made in the app can be deleted in it), from Event
// Partner's Host tab, Play Partner's Venue tab and Crew's screen. One screen in three steps:
// - the account: its ways in, read only from GET /me/security (the Orbit app's Sign-in and security changes them),
//   Delete account and Sign out;
// - Delete account: the Orbit app's screen (app/src/app/account/delete.tsx) on GET /me/deletion, with what blocks it
//   (a host you started, by name), what goes, what is wiped and what stays;
// - Confirm it's you, when this device hasn't proved a way in for 10 minutes: a code to the account's own phone or
//   email, then POST /me/fresh. The host apps sign in with codes only, so Google, Apple and passkeys aren't offered.
//   During the 7-day hold after a new phone signs in by number (GET /me/security heldUntil) only the email proves it;
//   with no email, the Orbit app's other ways in do.
// Then POST /me/deletion: every device signs out, this one too, and the due date shows. Its refusals, and a refused
// code, come up as an alert (the Orbit app's delete.tsx does the same), not under a list that runs off the screen.
// An account already set to be deleted (signed in again within the 30 days) gets Keep my account: POST
// /me/deletion/keep.
import type { Security } from '@orbit/contract';
import { useLoad } from '@orbit/mobile/load';
import { showPhone } from '@orbit/mobile/signin';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Card, Field, Note, Pill, Row, Section, Wide } from '../launch/ui';
import { requestCode } from '../proof';
import { api, refreshMe, signOut, useSession } from '../session';
import { clock, secondsLeft } from '../signinSteps';
import { Frame, s } from './request';

type Blocker = { kind: 'ownsHost'; hostId: string; name: string } | { kind: 'onlyStaffHolder' };
type Deletion = { deleted: string[]; scrubbed: string[]; kept: string[]; blockers: Blocker[]; dueAt: string | null };
type Via = 'phone' | 'email';
type Step = { at: 'account' } | { at: 'delete' } | { at: 'confirm'; sec: Security } | { at: 'code'; via: Via; to: string; shown: string; until: number };

const DAY = 86_400_000;
const day = (at: string | number) => new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
// Where the fix is: an owner archives from the host's Status card (launch/status.tsx), in whichever host app runs it.
const say = (b: Blocker) =>
  b.kind === 'ownsHost'
    ? { label: `Archive ${b.name}, the host you started`, note: 'Its Status card: the Host tab in Orbit Event Partner, the Venue tab in Orbit Play Partner' }
    : { label: 'Give Staff to someone else first', note: undefined };
// As the Orbit app shows them (app/src/account/rules.ts): enough to recognise your own, not to read someone else's.
// "+91 98••• ••210", "k•••@example.com".
const maskPhone = (e164: string) => {
  const local = e164.replace(/^\+91/, '');
  return `+91 ${local.slice(0, 2)}••• ••${local.slice(-3)}`;
};
const maskEmail = (email: string) => {
  const at = email.indexOf('@');
  return at < 1 ? email : `${email[0]}•••${email.slice(at)}`;
};

export default function Account() {
  const me = useSession()?.me;
  const [step, setStep] = useState<Step>({ at: 'account' });
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // `busy`, read at once: one request at a time
  const [problem, setProblem] = useState<string | null>(null);
  const sec = useLoad<Security>(me ? `security|${me.id}` : null, () => api.authed<Security>('GET', '/me/security'));
  const del = useLoad<Deletion>(me && step.at !== 'account' ? `deletion|${me.id}` : null, () => api.authed<Deletion>('GET', '/me/deletion'), { keep: true });
  const go = (next: Step) => {
    setProblem(null);
    setStep(next);
  };
  const back = () => {
    if (busy) return;
    if (step.at === 'account') return router.canGoBack() ? router.back() : router.replace('/');
    go(step.at === 'delete' ? { at: 'account' } : { at: 'delete' });
  };

  // One request at a time; its message shows under the step, or as an alert when `loud`. False when the API said no.
  async function run<T>(request: () => Promise<{ ok: true; data: T } | { ok: false; error: { error: string; message: string; retryIn?: number } }>, then: (data: T) => void, loud = false) {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setProblem(null);
    const r = await request();
    working.current = false;
    setBusy(false);
    if (!r.ok) {
      if (loud) Alert.alert(r.error.message);
      else setProblem(r.error.message);
      return false;
    }
    then(r.data);
    return true;
  }

  // The deletion itself. Needs a fresh check: an API that says so (the 10 minutes ran out on the way) asks for one.
  const remove = () =>
    run(
      () => api.authed<{ dueAt: string }>('POST', '/me/deletion'),
      ({ dueAt }) => {
        signOut(); // every session has ended on the API, this one too; the guards go to Sign in
        Alert.alert('Account set to be deleted', `Your account will be deleted on ${day(dueAt)}. To keep it, sign in to the Orbit app before then and tap Keep my account.`);
      },
      true,
    ).then((ok) => {
      if (ok !== false) return;
      setStep((now) => (now.at === 'delete' ? now : { at: 'delete' }));
      del.reload(); // a blocker that came since, or a deletion already asked for
    });
  // Delete: straight on when this device is fresh and not held, otherwise Confirm it's you first.
  const start = () =>
    void run(
      () => api.authed<Security>('GET', '/me/security'),
      (now) => (now.fresh && !now.heldUntil ? void remove() : go({ at: 'confirm', sec: now })),
      true,
    );
  // Keep my account: the pending deletion called off, and the account read again.
  const keep = () =>
    void run(
      () => api.authed('POST', '/me/deletion/keep'),
      () => {
        void refreshMe();
        del.reload();
        Alert.alert('Your account stays', 'It won’t be deleted.');
      },
      true,
    );
  const send = (via: Via, to: string, shown: string) =>
    void run(
      async () => {
        const r = await requestCode(to);
        // One sent under 30 seconds ago still works, so go to it.
        return !r.ok && r.error.error === 'tooSoon' ? { ok: true as const, data: { retryIn: r.error.retryIn ?? 30 } } : r;
      },
      (d) => go({ at: 'code', via, to, shown, until: Date.now() + d.retryIn * 1000 }),
    );
  const check = (via: Via, code: string) => run(() => api.authed('POST', '/me/fresh', { via, code }), () => void remove(), true);

  if (!me) return null;
  const w = sec.data;
  const d = del.data;
  const blocked = !!d && d.blockers.length > 0;
  const due = d?.dueAt ?? me.deletionDue;

  if (step.at === 'account')
    return (
      <Frame step={null} onBack={back}>
        <Text style={s.title} accessibilityRole="header">
          Account
        </Text>
        <Text style={s.line}>{me.name ?? 'Your Orbit account'}, the one account for every Orbit app.</Text>
        {me.deletionDue && <Note>{`Your account is set to be deleted on ${day(me.deletionDue)}. Keep my account calls that off.`}</Note>}
        <Section title="Ways in" />
        {sec.error && !w && (
          <>
            <Note>{sec.error.message}</Note>
            <View style={s.retry}>
              <Pill label="Try again" onPress={sec.reload} />
            </View>
          </>
        )}
        {w && (
          <>
            <Card>
              {w.phone && <Row label="Phone" value={showPhone(w.phone)} />}
              {w.email && <Row label="Email" value={w.email} />}
              {w.google && <Row label="Google" value={w.google.email ?? 'Linked'} />}
              {w.apple && <Row label="Apple" value={w.apple.email ?? 'Linked'} />}
              {w.passkeys.length > 0 && <Row label="Passkeys" value={String(w.passkeys.length)} />}
            </Card>
            <Note>Change these in the Orbit app, under Account, Sign-in and security.</Note>
          </>
        )}
        <Section title="Account" />
        <Card>
          {me.deletionDue ? <Row label={busy ? 'Keeping…' : 'Keep my account'} onPress={busy ? undefined : keep} /> : <Row label="Delete account" onPress={() => go({ at: 'delete' })} />}
          <Row label="Sign out" plain onPress={signOut} />
        </Card>
      </Frame>
    );

  if (step.at === 'delete')
    return (
      <Frame
        step={null}
        onBack={back}
        foot={
          d && (
            <Wide
              label={busy ? 'Deleting…' : 'Delete account'}
              disabled={busy || blocked || !!due}
              onPress={() =>
                Alert.alert('Delete your account?', `Every device signs out now. Your account is deleted on ${day(Date.now() + 30 * DAY)}. Sign in to the Orbit app before then to keep it.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: start },
                ])
              }
            />
          )
        }
      >
        <Text style={s.title} accessibilityRole="header">
          Delete account
        </Text>
        <Text style={s.line}>This deletes your Orbit account in every Orbit app, not only this one.</Text>
        {del.error && !d && (
          <>
            <Note>{del.error.message}</Note>
            <View style={s.retry}>
              <Pill label="Try again" onPress={del.reload} />
            </View>
          </>
        )}
        {d && (
          <>
            <Section title="Deleted on" />
            <Card>
              <Row label={due ? day(due) : day(Date.now() + 30 * DAY)} note={due ? 'Already asked for' : undefined} />
              {due && <Row label={busy ? 'Keeping…' : 'Keep my account'} onPress={busy ? undefined : keep} />}
            </Card>
            {blocked && (
              <>
                <Section title="Before it can go" />
                <Card>
                  {d.blockers.map((b) => (
                    <Row key={b.kind === 'ownsHost' ? b.hostId : b.kind} {...say(b)} />
                  ))}
                </Card>
              </>
            )}
            <List title="What is deleted" rows={d.deleted} />
            <List title="What is wiped from what stays" rows={d.scrubbed} />
            <List title="What is kept" rows={d.kept} />
          </>
        )}
        {problem && <Note live>{problem}</Note>}
      </Frame>
    );

  if (step.at === 'confirm') {
    const { phone, email, heldUntil } = step.sec;
    return (
      <Frame step={null} onBack={back}>
        <Text style={s.title} accessibilityRole="header">
          Confirm it’s you
        </Text>
        {heldUntil ? (
          <Text style={s.line}>
            {email
              ? `This phone signed in by number in the last 7 days, so till ${day(heldUntil)} only your email proves it’s you.`
              : `This phone signed in by number in the last 7 days. To delete before ${day(heldUntil)}, open the Orbit app and confirm it’s you with Google, Apple or a passkey you had before.`}
          </Text>
        ) : (
          <Text style={s.line}>A code to your account’s own number or email, before it’s deleted.</Text>
        )}
        <View style={s.fields}>
          {phone && !heldUntil && <Wide label={`Code to ${maskPhone(phone)}`} disabled={busy} onPress={() => send('phone', phone, `On WhatsApp to ${maskPhone(phone)}`)} />}
          {email && <Wide label={`Code to ${maskEmail(email)}`} disabled={busy} onPress={() => send('email', email, `Emailed to ${maskEmail(email)}`)} />}
        </View>
        {problem && <Note live>{problem}</Note>}
      </Frame>
    );
  }

  return <Code step={step} busy={busy} problem={problem} onBack={back} onCode={(code) => check(step.via, code)} onResend={() => send(step.via, step.to, step.shown)} />;
}

function List({ title, rows }: { title: string; rows: string[] }) {
  return (
    <>
      <Section title={title} />
      <Card>
        {rows.map((x) => (
          <Row key={x} label={x} />
        ))}
      </Card>
    </>
  );
}

// The code, as Sign in takes it (signin.tsx): a full code goes at once, a refused one clears for the next try.
function Code({ step, busy, problem, onBack, onCode, onResend }: { step: Extract<Step, { at: 'code' }>; busy: boolean; problem: string | null; onBack: () => void; onCode: (code: string) => Promise<boolean | null>; onResend: () => void }) {
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = secondsLeft(step.until, now);
  const submit = (c: string) => void onCode(c).then((ok) => ok === false && setCode(''));
  const type = (t: string) => {
    const digits = t.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) submit(digits);
  };
  return (
    <Frame step={null} onBack={onBack} foot={<Wide label={busy ? 'Checking…' : 'Confirm and delete'} disabled={code.length !== 6 || busy} onPress={() => submit(code)} />}>
      <Text style={s.title} accessibilityRole="header">
        Enter the code
      </Text>
      <Text style={s.line}>{step.shown}.</Text>
      <View style={s.fields}>
        <Field label="6-digit code" code value={code} onChangeText={type} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} autoFocus />
      </View>
      {problem && <Note live>{problem}</Note>}
      <View style={s.retry}>
        <Pill label={left > 0 ? `Resend in ${clock(left)}` : 'Resend the code'} onPress={left > 0 || busy ? undefined : onResend} />
      </View>
    </Frame>
  );
}
