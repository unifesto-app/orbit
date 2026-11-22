import { Sheet, SheetSays } from '../station/ui';

// The scanner's own take comes next (one take at a time): point at the ticket's QR, tap how many, and its answers.
export default function Scan() {
  return (
    <Sheet title="Scan a ticket">
      <SheetSays text="The scanner comes next: point the camera at a ticket’s QR, tap how many are here, and it tells you if it’s too early, ended, released or not for this venue." />
    </Sheet>
  );
}
