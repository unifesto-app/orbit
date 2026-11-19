// Cities for the location pickers (the web's navbar, the app's location screen), by state or union territory.
// Edit freely: the pickers sort them A to Z.
// Until the API knows which cities have events, this is a fixed list.
const byState: Record<string, string[]> = {
  "Andaman and Nicobar Islands": ["Port Blair"],
  "Andhra Pradesh": ["Amaravati", "Anantapur", "Bhimavaram", "Chittoor", "Eluru", "Guntur", "Kadapa", "Kakinada", "Kurnool", "Machilipatnam", "Nellore", "Ongole", "Proddatur", "Rajahmundry", "Srikakulam", "Tenali", "Tirupati", "Vijayawada", "Visakhapatnam", "Vizianagaram"],
  "Arunachal Pradesh": ["Itanagar"],
  Assam: ["Dibrugarh", "Guwahati", "Jorhat", "Silchar", "Tezpur"],
  Bihar: ["Bhagalpur", "Darbhanga", "Gaya", "Muzaffarpur", "Patna"],
  Chandigarh: ["Chandigarh"],
  Chhattisgarh: ["Bhilai", "Bilaspur", "Durg", "Korba", "Raipur"],
  Delhi: ["Delhi"],
  Goa: ["Margao", "Panaji", "Vasco da Gama"],
  Gujarat: ["Ahmedabad", "Anand", "Bhavnagar", "Gandhinagar", "Jamnagar", "Rajkot", "Surat", "Vadodara"],
  Haryana: ["Ambala", "Faridabad", "Gurugram", "Hisar", "Karnal", "Panipat", "Rohtak", "Sonipat"],
  "Himachal Pradesh": ["Dharamshala", "Manali", "Shimla"],
  "Jammu and Kashmir": ["Jammu", "Srinagar"],
  Jharkhand: ["Bokaro", "Dhanbad", "Jamshedpur", "Ranchi"],
  Karnataka: ["Ballari", "Belagavi", "Bengaluru", "Davanagere", "Hubballi", "Kalaburagi", "Mangaluru", "Manipal", "Mysuru", "Shivamogga", "Tumakuru", "Udupi"],
  Kerala: ["Kannur", "Kochi", "Kollam", "Kottayam", "Kozhikode", "Palakkad", "Thiruvananthapuram", "Thrissur"],
  Ladakh: ["Leh"],
  "Madhya Pradesh": ["Bhopal", "Gwalior", "Indore", "Jabalpur", "Ujjain"],
  Maharashtra: ["Amravati", "Chhatrapati Sambhajinagar", "Kolhapur", "Mumbai", "Nagpur", "Nashik", "Navi Mumbai", "Pune", "Solapur", "Thane"],
  Manipur: ["Imphal"],
  Meghalaya: ["Shillong"],
  Mizoram: ["Aizawl"],
  Nagaland: ["Dimapur", "Kohima"],
  Odisha: ["Berhampur", "Bhubaneswar", "Cuttack", "Puri", "Rourkela"],
  Puducherry: ["Puducherry"],
  Punjab: ["Amritsar", "Bathinda", "Jalandhar", "Ludhiana", "Mohali", "Patiala"],
  Rajasthan: ["Ajmer", "Bikaner", "Jaipur", "Jodhpur", "Kota", "Udaipur"],
  Sikkim: ["Gangtok"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Erode", "Madurai", "Salem", "Thanjavur", "Tiruchirappalli", "Tirunelveli", "Tiruppur", "Vellore"],
  Telangana: ["Adilabad", "Hyderabad", "Karimnagar", "Khammam", "Mahabubnagar", "Nalgonda", "Nizamabad", "Ramagundam", "Siddipet", "Suryapet", "Warangal"],
  Tripura: ["Agartala"],
  "Uttar Pradesh": ["Agra", "Aligarh", "Bareilly", "Ghaziabad", "Gorakhpur", "Greater Noida", "Kanpur", "Lucknow", "Meerut", "Noida", "Prayagraj", "Varanasi"],
  Uttarakhand: ["Dehradun", "Haridwar", "Nainital", "Rishikesh", "Roorkee"],
  "West Bengal": ["Asansol", "Durgapur", "Howrah", "Kharagpur", "Kolkata", "Siliguri"],
};

export type City = { name: string; state: string };

export const allCities: City[] = Object.entries(byState)
  .flatMap(([state, names]) => names.map((name) => ({ name, state })))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

const find = (name: string) => allCities.find((c) => c.name === name)!;

// Orbit is open in Telangana and Andhra Pradesh only (owner, 19 Nov 2026: "only ap & telangana. other than it
// unserviceable. or coming soon"). Every other city is listed, as Coming soon.
export const servedStates = ["Telangana", "Andhra Pradesh"] as const;
// A phone's geocoder may name the state short, or in another case.
const SHORT: Record<string, string> = { TG: "Telangana", TS: "Telangana", AP: "Andhra Pradesh" };
const fullState = (s: string) => SHORT[s.trim().toUpperCase()] ?? byStateName(s.trim()) ?? s.trim();
const byStateName = (s: string) => Object.keys(byState).find((k) => k.toLowerCase() === s.toLowerCase());

/** Whether Orbit is open in a state. */
export const isServedState = (state: string) => (servedStates as readonly string[]).includes(fullState(state));

/**
 * A place's state: its own when it has one (a picked city's, or the phone's geocoder region), else the state of a
 * listed city by its area or city name, else its city when that names a state (a place saved before places carried
 * their state).
 */
export function stateOf(place: { area: string; city: string; state?: string }): string | undefined {
  if (place.state?.trim()) return fullState(place.state);
  const named = (n: string) => allCities.find((c) => c.name === n)?.state ?? byStateName(n);
  return named(place.area) ?? named(place.city);
}

/** Whether Orbit is open at a place. One it can't put in any state counts as open, so a gap in the list turns nobody away. */
export function isServed(place: { area: string; city: string; state?: string }): boolean {
  const state = stateOf(place);
  return state === undefined || isServedState(state);
}

// Hyderabad first, then the biggest cities across Telangana and Andhra Pradesh, the only places Orbit is open.
export const popularCities: City[] = ["Hyderabad", "Visakhapatnam", "Vijayawada", "Warangal", "Tirupati", "Guntur", "Nellore", "Karimnagar", "Kakinada", "Khammam", "Rajahmundry", "Nizamabad"].map(find);

// Cities whose name or state contains the query; names that start with it come first.
export function searchCities(query: string): City[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = allCities.filter((c) => c.name.toLowerCase().includes(q) || c.state.toLowerCase().includes(q));
  const starts = (c: City) => (c.name.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}
