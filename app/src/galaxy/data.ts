// Mock Galaxy data until the admin endpoints exist, following the Galaxy and Money flow docs. Counts and sums are
// invented; nothing about real people, hosts or payments goes in the app bundle, which every install can read.
// ponytail: static, like src/mock.ts; it goes when the admin endpoints land in @orbit/contract.
import type { StaffFeature } from '../modes';

// What's waiting for staff, for the top of the Dashboard (Galaxy doc, Dashboard): anything overdue first.
// Each row counts only for staff holding its feature (Roles doc).
export type Waiting = { label: string; count: number; overdue?: number; feature: StaffFeature };
export const waiting: Waiting[] = [
  { label: 'Requests', count: 5, feature: 'queues' },
  { label: 'Support', count: 7, overdue: 2, feature: 'queues' },
  { label: 'Content reports', count: 3, overdue: 1, feature: 'queues' },
  { label: 'Refunds', count: 2, feature: 'money' },
  { label: 'Payouts', count: 4, feature: 'money' },
  { label: 'Failed refunds', count: 0, feature: 'money' },
  { label: 'Reconciliation gaps', count: 0, feature: 'money' },
  { label: 'Disputes', count: 1, feature: 'money' },
];

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
    { label: 'Sales', paise: 158900000 },
    { label: 'Orbit’s fees', paise: 8739500 },
    { label: 'Refunds', paise: 2104000 },
    { label: 'Payouts paid', paise: 96320000 },
    { label: 'Held for hosts', paise: 51736500 },
    { label: 'Hosts owe', paise: 59800 },
  ],
};

// The Requests queue's seven kinds (Galaxy doc, The Requests queue), the support queue and content reports.
export const requests = [
  { label: 'Verify this host', count: 2 },
  { label: 'Put this host under a parent', count: 0 },
  { label: 'Change the owner', count: 1 },
  { label: 'Appeal a suspension', count: 0 },
  { label: 'Check this bank account', count: 1 },
  { label: 'More than 5 comp seats', count: 1 },
  { label: 'An early payout', count: 0 },
];
export const support = [
  { label: 'Open', count: 5 },
  { label: 'Waiting on the person', count: 2 },
  { label: 'Unverified', count: 1 },
];
export const reports = [
  { label: 'Events', count: 2, overdue: 1 },
  { label: 'Hosts', count: 0 },
  { label: 'Ticket problems', count: 1 },
];

// Galaxy's Money screens in the app, for staff with the Money feature; fees live here too now there's no staff web site.
export const money = [
  { label: 'Transactions today', value: '214 · ₹64,180' },
  { label: 'Disputed', value: '1' },
  { label: 'Refunds that reached Orbit', value: '2' },
  { label: 'Failed after retries', value: '0' },
  { label: 'Payouts waiting', value: '4 · ₹1,82,400' },
  { label: 'Orphaned payments', value: '1' },
  { label: 'Reconciliation', value: 'Last night, no gaps' },
];
