// The short line shown under an event's price on Discover, such as "12 seats left".
// Return null to show nothing. The spotlight card also draws its seat bar only when this returns a line.
//
// taken:    seats booked so far
// capacity: the event's limit, or null when it has none
export function seatsNote(taken: number, capacity: number | null): string | null {
  // TODO(founder): decide when scarcity is worth showing.
  void taken;
  void capacity;
  return null;
}
