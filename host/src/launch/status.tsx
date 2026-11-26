// A host's Status card, on Event Partner's Host tab and Play Partner's Venue tab: where it stands, and the owner's
// moves (statusMoves: Pause, Archive, Resume, Restore), each confirmed first, then POST /hosts/:id/<action> (the API
// refuses with its reason while bookings or payouts are open). Archive is also how an owner clears the way to Delete
// account. `onDone` reads the page again; the account is read again too (an archived host leaves the switcher).
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { api, refreshMe } from '../session';
import { type Status, type StatusAction, statusMoves, statusNote } from './team';
import { Card, Note, Row } from './ui';

const STATUS = { live: 'Live', paused: 'Paused', suspended: 'Suspended by Orbit', archived: 'Archived' } as const;

export function HostStatus({ id, status, owner, wait, value, onDone }: { id: string; status: Status; owner: boolean; wait: boolean; value?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // a quick second tap doesn't post twice
  const [error, setError] = useState<string | null>(null);
  const moves = statusMoves(status, owner, wait);
  const line = statusNote(status, owner, wait);

  const act = async (action: StatusAction) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await api.authed('POST', `/hosts/${id}/${action}`);
    working.current = false;
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    onDone();
    void refreshMe();
  };
  const move = (m: { label: string; action: StatusAction }) => {
    const away = m.action === 'pause' || m.action === 'archive';
    Alert.alert(`${m.label}?`, m.action === 'pause' ? 'You can resume it here.' : m.action === 'archive' ? 'You can restore it here.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: m.label.split(' ')[0]!, style: away ? 'destructive' : 'default', onPress: () => void act(m.action) },
    ]);
  };

  return (
    <>
      <Card>
        <Row label={STATUS[status]} dot={status === 'live'} value={value} />
        {moves.map((m) => (
          <Row key={m.label} label={m.label} value={m.value} onPress={m.open && !busy ? () => move(m) : undefined} />
        ))}
      </Card>
      {error && <Note live>{error}</Note>}
      {line && <Note>{line}</Note>}
    </>
  );
}
