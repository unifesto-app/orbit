// Mock Galaxy data until the admin endpoints exist, following the Galaxy, Money and Roles flow docs and the Galaxy
// canvas (16 Nov 2026). Names, numbers and contacts are invented; nothing about real people, hosts or payments goes in the
// app bundle, which every install can read. Times are against the mock clock, src/mock.ts `now` (Fri 20 Nov, 9 AM).
// ponytail: static, like src/mock.ts; it goes when the admin endpoints land in @orbit/contract.
import type { StaffFeature } from '../modes';

// ─── The dashboard ─────────────────────────────────────────────────────────────────────────────────────────────────

// The last 7 or 30 days against the period before, test data left out.
export type Count = { label: string; now: number; before: number; money?: boolean };
export const numbers: Record<'7 days' | '30 days', Count[]> = {
  '7 days': [
    { label: 'New people', now: 412, before: 368 },
    { label: 'New hosts', now: 9, before: 11 },
    { label: 'New events', now: 26, before: 21 },
    { label: 'Bookings', now: 1180, before: 1032 },
    { label: 'Money in', now: 41250000, before: 37890000, money: true },
  ],
  '30 days': [
    { label: 'New people', now: 1630, before: 1412 },
    { label: 'New hosts', now: 38, before: 35 },
    { label: 'New events', now: 97, before: 104 },
    { label: 'Bookings', now: 4410, before: 3986 },
    { label: 'Money in', now: 158900000, before: 141300000, money: true },
  ],
};

// This month's money, as the Dashboard's summary shows it by month.
export const month = {
  name: 'November',
  rows: [
    { label: 'Sales', paise: 128400000 },
    { label: 'Orbit’s fees', paise: 3852000 },
    { label: 'Refunds', paise: 1712000 },
    { label: 'Payouts paid', paise: 78200000 },
    { label: 'Held for hosts', paise: 44636000 },
    { label: 'Hosts owe', paise: 59800 },
  ],
};

// ─── People, as staff see them (Galaxy doc, People) ─────────────────────────────────────────────────────────────────

export type Account = {
  id: string;
  name: string;
  initials: string;
  bg: string;
  phone: string; // shown masked until Show
  email?: string;
  since: string;
  city?: string;
  suspended?: string; // until when
  ways?: string;
  devices?: [string, string][];
  bookings?: { title: string; line: string; date: string }[];
  hosts?: [string, string][]; // a host and the role on it
  messages?: { title: string; via: string; status: string }[];
  emails?: string; // set when emails to them bounce and are held back
  history?: [string, string][];
};
const person = (id: string, name: string, bg: string, phone: string, since: string, more: Partial<Account> = {}): Account => ({
  id,
  name,
  initials: name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join(''),
  bg,
  phone,
  since,
  ...more,
});
export const accounts: Account[] = [
  person('u_viewer', 'Abhinavtej Reddy', '#295EFF', '+919000000001', '2025'),
  person('sreeja', 'Sreeja Reddy', '#E8590C', '+919000000521', '2025', {
    email: 'sreeja@example.com',
    city: 'Hyderabad',
    ways: 'Phone, Google, 1 passkey',
    devices: [
      ['iPhone', 'Today'],
      ['Android', '3 Nov'],
    ],
    bookings: [
      { title: 'Udaan Cultural Fest', line: '2 tickets · ₹398 · paid', date: '25 Nov' },
      { title: 'Sunday Jam', line: '1 ticket · free', date: '22 Nov' },
      { title: 'Wednesday Screening', line: '1 ticket · ₹49 · refunded', date: '18 Nov' },
    ],
    hosts: [['Pixel Club, CBIT', 'Crew']],
    messages: [
      { title: 'Your Udaan tickets', via: 'Push and inbox', status: 'Delivered' },
      { title: 'Sign-in code', via: 'WhatsApp', status: 'Delivered' },
    ],
    emails: 'Bounced 12 Nov · held back',
    history: [
      ['Asha Menon searched by phone', 'Today'],
      ['Imran Sheikh refunded ₹49', '19 Nov'],
    ],
  }),
  person('rehan', 'Rehan Khan', '#5F3DC4', '+919000000087', '2026', { suspended: '30 Nov', history: [['Asha Menon suspended them', '19 Nov']] }),
  person('meera', 'Meera Iyer', '#0B7285', '+919000000342', '2025', { email: 'meera@example.com' }),
  person('rohan', 'Rohan Mehta', '#0F5257', '+919000000610', '2026'),
  person('nikhil', 'Nikhil Rao', '#7A1E28', '+919000000733', '2026'),
  person('divya', 'Divya Sen', '#C2255C', '+919000000458', '2026'),
];
export const accountOf = (id: string) => accounts.find((a) => a.id === id);

// ─── Hosts and events, as staff see them ────────────────────────────────────────────────────────────────────────────

export type HostFile = {
  since: string;
  team: { name: string; role: string; accountId?: string }[];
  money: [string, string][];
  fee: string;
  bank?: [string, string];
  history: [string, string][];
};
export const hostFiles: Record<string, HostFile> = {
  'reel-society': {
    since: 'Aug 2026',
    team: [
      { name: 'Nikhil Rao', role: 'Owner, Admin', accountId: 'nikhil' },
      { name: 'Divya Sen', role: 'Admin', accountId: 'divya' },
      { name: 'Tarun K', role: 'Crew' },
    ],
    money: [
      ['Sales, last 30 days', '₹14,210'],
      ['Refunds', '₹490'],
      ['Payouts paid', '₹9,800'],
      ['Held', '₹3,920'],
      ['Owes Orbit', 'Nothing'],
    ],
    fee: 'General · 3%',
    bank: ['HDFC •••• 7710', 'Verified'],
    history: [
      ['Asha Menon declined verification', '12 Oct'],
      ['Renamed from Reel Club', '2 Oct'],
    ],
  },
  'jam-circle': {
    since: 'Jun 2026',
    team: [{ name: 'Rohan Mehta', role: 'Owner, Admin', accountId: 'rohan' }],
    money: [['Sales, last 30 days', 'Free events only']],
    fee: 'General · 3%',
    history: [],
  },
};

export type EventFile = { status: string; sales: [string, string][]; history: [string, string][] };
export const eventFiles: Record<string, EventFile> = {
  'reel-society-screening': {
    status: 'Live',
    sales: [
      ['Booked', '41 of 60'],
      ['Money in', '₹2,009'],
      ['Refund requests', 'None'],
      ['Payout', 'Opens Sat 28 Nov'],
    ],
    history: [
      ['Divya Sen changed the price', '12 Nov'],
      ['Nikhil Rao published it', '11 Nov'],
    ],
  },
};

// ─── Queues (Galaxy doc, The Requests queue, Support, Content reports): each due within 24 hours ────────────────────

// The Requests queue's seven kinds, who decides each (the feature that owns it; Queues alone can see and reply) and the
// two ways it can go.
export type Kind = 'verify' | 'parent' | 'owner' | 'appeal' | 'bank' | 'comps' | 'early';
export const KINDS: Record<Kind, { title: string; feature: StaffFeature; yes: string; no: string }> = {
  verify: { title: 'Verify this host', feature: 'hosts', yes: 'Verify', no: 'Decline' },
  parent: { title: 'Put this host under a parent', feature: 'hosts', yes: 'Set it', no: 'Decline' },
  owner: { title: 'Change the owner', feature: 'hosts', yes: 'Change it now', no: 'Decline' },
  appeal: { title: 'Appeal a suspension', feature: 'hosts', yes: 'Lift it', no: 'Keep it' },
  bank: { title: 'Check this bank account', feature: 'money', yes: 'Verified', no: 'Reject' },
  comps: { title: 'More than 5 comp seats', feature: 'money', yes: 'Approve', no: 'Decline' },
  early: { title: 'An early payout', feature: 'money', yes: 'Allow it', no: 'Decline' },
};

type Rows = { title: string; rows: [string, string][] }[];
// `by` is who asked: always one of the host's Admins.
export type Request = { id: string; kind: Kind; hostId: string; by: { name: string; role: string; accountId?: string }; askedAt: string; sections: Rows; document?: string };
export const requests: Request[] = [
  {
    id: 'r-jam',
    kind: 'verify',
    hostId: 'jam-circle',
    by: { name: 'Rohan Mehta', role: 'Owner and Admin', accountId: 'rohan' },
    askedAt: '2026-11-20T06:00:00+05:30',
    sections: [
      { title: 'What they sent', rows: [['Website', 'jamcircle.in'], ['Instagram', '@jamcirclehyd'], ['Institutional email', 'None']] },
      { title: 'On Orbit', rows: [['Since', 'Jun 2026'], ['Events', '22'], ['Content reports', 'None']] },
    ],
  },
  {
    id: 'r-reel',
    kind: 'verify',
    hostId: 'reel-society',
    by: { name: 'Nikhil Rao', role: 'Owner and Admin', accountId: 'nikhil' },
    askedAt: '2026-11-20T00:00:00+05:30',
    sections: [{ title: 'What they sent', rows: [['Website', 'None'], ['Instagram', '@reelsocietyhyd'], ['Institutional email', 'None']] }],
  },
  {
    id: 'r-owner',
    kind: 'owner',
    hostId: 'clay-days',
    by: { name: 'Arjun Das', role: 'Admin' },
    askedAt: '2026-11-19T19:00:00+05:30',
    sections: [{ title: 'The change', rows: [['Owner now', 'Lata Iyer'], ['New owner', 'Arjun Das'], ['Lands', 'Thu 26 Nov, unless Lata cancels']] }],
  },
  {
    id: 'r-bank',
    kind: 'bank',
    hostId: 'founders-club',
    by: { name: 'Kabir Shah', role: 'Owner and Admin' },
    askedAt: '2026-11-19T15:00:00+05:30',
    sections: [
      {
        title: 'Bank account',
        rows: [['Holder', 'Hyderabad Founders Club LLP'], ['Account', '•••• 4821'], ['IFSC', 'HDFC0001234'], ['Decided after', 'Sun 22 Nov, 3:00 PM']],
      },
    ],
    document: 'Cancelled cheque',
  },
  {
    id: 'r-comps',
    kind: 'comps',
    hostId: 'mgit',
    by: { name: 'Ananth Rao', role: 'Admin' },
    askedAt: '2026-11-19T13:00:00+05:30',
    sections: [{ title: 'The ask', rows: [['Event', 'Udaan Cultural Fest'], ['Comp seats', '12'], ['Given so far', '5']] }],
  },
];

export type TicketStatus = 'Open' | 'Waiting on the person' | 'Resolved';
export type Ticket = {
  id: string;
  title: string;
  from: string;
  accountId?: string; // none: sent signed out, "Unverified"
  askedAt: string;
  status: TicketStatus;
  about?: { label: string; note: string }[];
  messages?: { from: string; when: string; text: string; staff?: boolean }[];
};
export const tickets: Ticket[] = [
  {
    id: 't-refund',
    title: 'Refund not received',
    from: 'Meera Iyer',
    accountId: 'meera',
    askedAt: '2026-11-19T06:00:00+05:30',
    status: 'Open',
    about: [{ label: 'Udaan Cultural Fest', note: '2 tickets · ₹398 · refund approved Sat' }],
    messages: [
      { from: 'Meera Iyer', when: 'Thu 6:00 AM', text: 'Cultural Committee said yes to my refund on Saturday, but nothing has come back to my UPI.' },
      { from: 'Asha Menon, as Orbit', when: 'Thu 11:40 AM', text: 'Sorry, Meera. I’m checking the refund with Razorpay now.', staff: true },
      { from: 'Meera Iyer', when: 'Today 8:05 AM', text: 'Still nothing.' },
    ],
  },
  { id: 't-signin', title: 'Can’t sign in on my new phone', from: 'Unverified', askedAt: '2026-11-19T08:00:00+05:30', status: 'Open' },
  { id: 't-date', title: 'Ticket shows the wrong date', from: 'Rahul Verma', askedAt: '2026-11-20T07:00:00+05:30', status: 'Open' },
  { id: 't-name', title: 'Wrong name on my booking', from: 'Aditi Rao', askedAt: '2026-11-20T04:00:00+05:30', status: 'Open' },
  { id: 't-friend', title: 'Can I bring a friend?', from: 'Karthik N', askedAt: '2026-11-20T01:00:00+05:30', status: 'Open' },
  { id: 't-payout', title: 'Payout to the wrong account', from: 'Nikhil Rao', accountId: 'nikhil', askedAt: '2026-11-18T09:00:00+05:30', status: 'Waiting on the person' },
  { id: 't-phone', title: 'Change my phone number', from: 'Sneha Kapoor', askedAt: '2026-11-17T09:00:00+05:30', status: 'Waiting on the person' },
];

export type Report = {
  id: string;
  eventId: string;
  askedAt: string;
  byOrbit?: boolean; // filed by the risk screen
  ticket?: boolean; // a ticket problem rather than the listing
  reports: { reason: string; from: string; ago: string; text: string }[];
};
export const reports: Report[] = [
  {
    id: 'rep-screening',
    eventId: 'reel-society-screening',
    askedAt: '2026-11-19T07:00:00+05:30',
    reports: [
      { reason: 'Misleading', from: 'Kavya S', ago: '26h ago', text: 'The page says it’s a new release. It’s a 1975 film.' },
      { reason: 'Misleading', from: 'Arun P', ago: '20h ago', text: 'Not a premiere.' },
      { reason: 'Something else', from: 'Divya M', ago: '6h ago', text: 'The poster is copied from another club’s screening.' },
    ],
  },
  {
    id: 'rep-esports',
    eventId: 'campus-esports-cup',
    askedAt: '2026-11-20T04:00:00+05:30',
    ticket: true,
    reports: [{ reason: 'Ticket problem', from: 'Varun T', ago: '5h ago', text: 'Charged twice for one team ticket.' }],
  },
  {
    id: 'rep-breakfast',
    eventId: 'founders-breakfast',
    askedAt: '2026-11-20T08:00:00+05:30',
    byOrbit: true,
    reports: [{ reason: 'Risk screen', from: 'Orbit', ago: '1h ago', text: 'The price changed three times in an hour.' }],
  },
];

// ─── Money (Money flow, Orbit's side in Galaxy) ──────────────────────────────────────────────────────────────────

export type Payout = {
  id: string;
  hostId: string;
  event: string;
  askedAt: string;
  salesPaise: number;
  refundsPaise: number;
  feePaise: number;
  bank: [string, string][];
};
export const payoutPaise = (p: Payout) => p.salesPaise - p.refundsPaise - p.feePaise;
const bank = (holder: string, account: string, ifsc: string): [string, string][] => [
  ['Holder', holder],
  ['Account', account],
  ['IFSC', ifsc],
  ['Checked', 'Verified'],
];
export const payouts: Payout[] = [
  { id: 'po-clay', hostId: 'clay-days', event: 'Pottery for Beginners, Thu 12 Nov', askedAt: '2026-11-18T09:00:00+05:30', salesPaise: 1499000, refundsPaise: 149900, feePaise: 40500, bank: bank('Clay Days Studio', 'ICICI •••• 3392', 'ICIC0000123') },
  { id: 'po-mgit', hostId: 'mgit', event: 'Udaan pre-fest night, Sat 14 Nov', askedAt: '2026-11-18T14:00:00+05:30', salesPaise: 11940000, refundsPaise: 398000, feePaise: 346300, bank: bank('MGIT Cultural Committee', 'SBI •••• 0457', 'SBIN0011234') },
  // Kickoff's: the mock viewer is Crew there, so it shows read only (staff never act on their own hosts).
  { id: 'po-kickoff', hostId: 'kickoff', event: 'Sunday 5-a-side Football, Sun 15 Nov', askedAt: '2026-11-19T10:00:00+05:30', salesPaise: 298000, refundsPaise: 0, feePaise: 8900, bank: bank('Kickoff Hyderabad', 'Axis •••• 2210', 'UTIB0000221') },
  { id: 'po-reel', hostId: 'reel-society', event: 'Wednesday Screening, Wed 11 Nov', askedAt: '2026-11-19T20:00:00+05:30', salesPaise: 254800, refundsPaise: 4900, feePaise: 7500, bank: bank('Reel Society', 'HDFC •••• 7710', 'HDFC0005678') },
];

// The rest of Money, as counts and lines until its screens are built.
export const money = {
  refunds: 2, // refunds that reached Orbit
  failedRefunds: 0,
  orphaned: 1,
  disputed: 1,
  disputedLine: '1 · ₹1,499 held',
  gaps: 0, // reconciliation gaps
  reconciliation: [
    ['Last night', 'No gaps'],
    ['Captured', '₹64,180'],
    ['Refunded', '₹1,490'],
    ['Settled', '₹58,900'],
  ] as [string, string][],
  transactions: '214 today · ₹64,180',
  fees: 'General 3% · 2 deals',
};

// ─── Platform: staff and the audit log (Roles doc) ──────────────────────────────────────────────────────────────

export const FEATURE_NAMES: Record<StaffFeature, string> = {
  people: 'People',
  hosts: 'Hosts and events',
  queues: 'Queues',
  money: 'Money',
  platform: 'Platform',
  staff: 'Staff',
};
export type StaffMember = {
  id: string;
  name: string;
  owner?: boolean;
  features: StaffFeature[];
  // Waiting for a second Staff holder's confirm; the platform owner's own adds land after 24 hours instead.
  waiting?: { addedBy: string; lands?: string }; // addedBy is a staff id
};
export const staff: StaffMember[] = [
  { id: 'kavya', name: 'Kavya Sharma', features: ['people', 'queues'], waiting: { addedBy: 'leela' } },
  { id: 'rohit', name: 'Rohit Kumar', features: ['money'], waiting: { addedBy: 'u_viewer', lands: 'in 18h' } },
  { id: 'u_viewer', name: 'Abhinavtej Reddy', owner: true, features: [] },
  { id: 'asha', name: 'Asha Menon', features: ['people', 'hosts', 'queues'] },
  { id: 'imran', name: 'Imran Sheikh', features: ['money', 'queues'] },
  { id: 'leela', name: 'Leela Joseph', features: ['platform', 'staff'] },
];

// Every staff change, page opened, search and reveal (Galaxy decision 7), newest first.
export type AuditRow = { kind: 'change' | 'open'; text: string; note: string; day: 'Today' | 'Yesterday'; time: string };
export const audit: AuditRow[] = [
  { kind: 'change', text: 'Asha Menon dismissed a report', note: 'Sunday Jam · “Not a problem”', day: 'Today', time: '8:42 AM' },
  { kind: 'open', text: 'Asha Menon showed an email', note: 'Meera Iyer', day: 'Today', time: '8:31 AM' },
  { kind: 'change', text: 'Imran Sheikh marked a payout paid', note: 'Respawn Club · ₹21,460', day: 'Today', time: '7:58 AM' },
  { kind: 'open', text: 'Asha Menon searched by phone', note: '+91 90••• ••521', day: 'Today', time: '7:40 AM' },
  { kind: 'change', text: 'Leela Joseph removed Arvind Pillai', note: 'Every feature taken away', day: 'Today', time: '7:12 AM' },
  { kind: 'change', text: 'Imran Sheikh refunded ₹49', note: 'Sreeja Reddy · Wednesday Screening', day: 'Yesterday', time: '6:20 PM' },
  { kind: 'change', text: 'Asha Menon suspended Rehan Khan', note: '“Selling fake tickets” · until 30 Nov', day: 'Yesterday', time: '4:07 PM' },
  { kind: 'open', text: 'Asha Menon opened Rehan Khan’s page', note: '', day: 'Yesterday', time: '4:05 PM' },
];
