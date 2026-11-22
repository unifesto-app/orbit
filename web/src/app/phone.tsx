// The app's screens, drawn in HTML on the homepage as Apple draws its own on apple.com (owner, 22 Nov 2026: "instead
// of screenshots. build an ui in home. like apple site"). Built from the app's parts at its own sizes (a 390pt phone,
// app/src and mobile/src), then scaled with the frame (phone.module.css). Sample content, as in the store screens, with
// no place names; the posters are drawn in CSS. Each phone is one picture to a screen reader, its `label`.
import type { ReactNode } from "react";
import { Icon } from "./icons";
import s from "./phone.module.css";

export function Phone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.phone} role="img" aria-label={label}>
      <div className={s.screen}>
        <div className={s.status}>
          <span>9:41</span>
          <i className={s.island} />
          <span className={s.signal}>
            <i />
            <i />
            <i />
            <i />
            <b />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

const Round = ({ children, light }: { children: ReactNode; light?: boolean }) => (
  <span className={light ? `${s.round} ${s.frost}` : s.round}>{children}</span>
);

const Says = ({ title, text }: { title?: string; text: string }) => (
  <div className={s.says}>
    {/* eslint-disable-next-line @next/next/no-img-element -- Orbit's orb, 28pt */}
    <img src="/orb.webp" alt="" width={28} height={28} />
    <p className={s.bubble}>
      {title && <strong>{title}</strong>}
      {text}
    </p>
  </div>
);

// Home: the location and profile on dark glass over the 4:3 carousel, your tickets, then the hosts you follow; the tab
// bar and the chat orb at the foot.
export function HomeScreen() {
  return (
    <>
      <div className={s.carousel}>
        <div className={`${s.poster} ${s.respawn}`}>
          <small>Esports · Every Saturday</small>
          <b>
            RESPAWN
            <br />
            <em>CLUB</em>
          </b>
          <i className={s.tile} />
          <i className={s.plus}>+</i>
        </div>
        <span className={`${s.pill} ${s.dark}`}>View events</span>
      </div>
      <div className={s.top}>
        <span className={`${s.pill} ${s.dark} ${s.place}`}>
          <Icon name="pin" size={16} />
          Near you
        </span>
        <span className={s.right}>
          <Round>
            <Icon name="bell" size={20} />
          </Round>
          <span className={s.me}>A</span>
        </span>
      </div>
      <div className={s.dots}>
        <i className={s.on} />
        <i />
        <i />
        <i />
        <i />
      </div>
      <h4 className={s.h}>Your tickets</h4>
      <div className={s.ticket}>
        <i className={`${s.thumb} ${s.orange}`} />
        <div>
          <strong>Open Mic Night</strong>
          <span>Tonight, 8:00 PM</span>
          <small>Punchline Collective</small>
        </div>
        <span className={`${s.pill} ${s.frost} ${s.small}`}>View ticket</span>
      </div>
      <h4 className={s.h}>Next from your orbit</h4>
      <div className={s.feed}>
        <i className={`${s.thumb} ${s.navy}`} />
        <div>
          <small>CircuitFeed · Just announced</small>
          <strong>Build Anything Hackathon</strong>
          <span>Sat, 9:00 AM</span>
        </div>
      </div>
      <div className={s.tabs}>
        <span className={s.capsule}>
          <span className={s.open}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the open tab's filled icon */}
            <img src="/home-on.webp" alt="" width={22} height={22} />
            Home
          </span>
          <span>
            <Icon name="search" size={22} />
            Search
          </span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element -- the chat orb */}
        <img className={s.orb} src="/orb.webp" alt="" width={52} height={52} />
      </div>
    </>
  );
}

// Orbit's chat: its colours rolled out behind, Orbit's bubble and your answers, and the field.
export function ChatScreen() {
  return (
    <div className={s.chat}>
      <div className={s.top}>
        <span className={s.left}>
          <Round>
            <Icon name="back" size={20} />
          </Round>
          {/* eslint-disable-next-line @next/next/no-img-element -- the orb */}
          <img src="/orb.webp" alt="" width={28} height={28} />
          <strong>Orbit</strong>
        </span>
        <Round>
          <Icon name="info" size={20} />
        </Round>
      </div>
      <div className={s.thread}>
        <Says title="Find something to do" text="Ask about events, places to play and hosts near you." />
        <div className={s.answers}>
          {["Comedy this weekend", "Turf slots tonight", "Free events near me", "Hackathons this month"].map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      </div>
      <div className={s.field}>
        <Round light>
          <Icon name="plus" size={20} />
        </Round>
        <span>
          Ask about events near you
          <Icon name="mic" size={20} />
        </span>
      </div>
    </div>
  );
}

// An event page: the 4:3 poster under the back bar, the host, the title and who's on, its status, When and Where, what
// Orbit says, and the pay bar.
function EventPage({
  poster,
  host,
  title,
  with: lineup,
  status,
  card,
  says,
  price,
  left,
}: {
  poster: ReactNode;
  host: [string, string];
  title: string;
  with: string;
  status: string;
  card: ReactNode;
  says: string;
  price: string;
  left: string;
}) {
  return (
    <>
      {poster}
      <div className={s.top}>
        <Round>
          <Icon name="back" size={20} />
        </Round>
        <span className={s.right}>
          <Round>
            <Icon name="star" size={20} />
          </Round>
          <Round>
            <Icon name="more" size={20} />
          </Round>
        </span>
      </div>
      <div className={s.body}>
        <p className={s.host}>
          <i style={{ background: host[1] }}>{host[0].slice(0, 1)}</i>
          {host[0]}
          <span className={s.tick}>
            <Icon name="verified" size={14} />
          </span>
        </p>
        <h4>{title}</h4>
        <p className={s.with}>{lineup}</p>
        <p className={s.state}>
          <i />
          {status}
        </p>
        {card}
        <Says title="Thinking of going?" text={says} />
      </div>
      <div className={s.pay}>
        <span>
          <strong>{price}</strong>
          <small>{left}</small>
        </span>
        <span className={`${s.pill} ${s.frost} ${s.big}`}>Book ticket</span>
      </div>
    </>
  );
}

const Row = ({ label, value, line }: { label: string; value: string; line: string }) => (
  <div className={s.row}>
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
      <small>{line}</small>
    </span>
    <Icon name="chevron" size={16} />
  </div>
);

export function ComedyScreen() {
  return (
    <EventPage
      poster={
        <div className={`${s.poster} ${s.openMic}`}>
          <small>Punchline Collective</small>
          <b>
            OPEN MIC
            <br />
            NIGHT
          </b>
          <i className={s.mic} />
          <small className={s.when}>Every Friday · 8 PM</small>
        </div>
      }
      host={["Punchline Collective", "#FCC419"]}
      title="Open Mic Night"
      with="with Arjun Rao"
      status="Almost full · 9 seats left"
      card={
        <div className={s.card}>
          <Row label="When" value="Fri, 8:00 PM" line="Every Friday" />
          <Row label="Where" value="The Green Room" line="Open in Maps" />
        </div>
      }
      says="185 people are interested."
      price="₹299"
      left="9 seats left"
    />
  );
}

export function HackathonScreen() {
  return (
    <EventPage
      poster={
        <div className={`${s.poster} ${s.hack}`}>
          <small>CircuitFeed presents</small>
          <b>
            BUILD
            <br />
            ANYTHING
          </b>
          <em>HACKATHON</em>
          <i className={s.code}>&lt;/&gt;</i>
        </div>
      }
      host={["CircuitFeed", "#1098AD"]}
      title="Build Anything Hackathon"
      with="24 hours · Teams of 2 to 4"
      status="Filling fast · 18 teams in"
      card={
        <div className={s.card}>
          <div className={s.team}>
            <span>
              <small>Your team</small>
              <strong>Null Pointers</strong>
            </span>
            <span className={s.faces}>
              <i>A</i>
              <i>R</i>
              <i>S</i>
              <i className={s.empty}>+</i>
            </span>
          </div>
          <div className={s.rounds}>
            {[
              ["Ideas", "Sat, 10:00 AM"],
              ["Build", "24 hours"],
              ["Demos and results", "Sun, 10:00 AM"],
            ].map(([round, when], i) => (
              <p key={round}>
                <i className={i === 0 ? s.now : undefined} />
                <strong>{round}</strong>
                <small>{when}</small>
              </p>
            ))}
          </div>
        </div>
      }
      says="161 people are interested."
      price="₹1,799"
      left="a team of up to 4"
    />
  );
}

// The slot sheet: what, which day, the start, how long, and a hold.
export function SlotScreen() {
  const times = ["9:00", "10:00", "11:00", "12:00", "1:00", "2:00", "3:00", "4:00", "5:00", "6:00", "7:00", "8:00"];
  const gone = new Set(["10:00", "11:00", "2:00", "3:00", "4:00", "5:00"]);
  return (
    <div className={s.sheet}>
      <i className={s.grabber} />
      <div className={s.sheetHead}>
        <span>
          <h4>Book a slot</h4>
          <small>Kickoff Arena</small>
        </span>
        <Round light>
          <Icon name="close" size={18} />
        </Round>
      </div>
      <div className={s.segment}>
        <span className={s.open}>Slot</span>
        <span>Pay</span>
      </div>
      <div className={s.card}>
        <small className={s.label}>What</small>
        <div className={s.chips}>
          <span className={s.picked}>
            <i />
            5-a-side football · ₹1,200/hr
          </span>
          <span>Box cricket · ₹1,000/hr</span>
        </div>
      </div>
      <div className={s.card}>
        <small className={s.label}>Day</small>
        <div className={s.chips}>
          <span className={s.picked}>
            <i />
            Today
          </span>
          <span>Tomorrow</span>
          <span>Sat</span>
          <span>Sun</span>
        </div>
        <small className={s.label}>Start</small>
        <div className={s.times}>
          {times.map((t) => (
            <span key={t} className={t === "6:00" ? s.picked : gone.has(t) ? s.gone : undefined}>
              {t} {Number(t.split(":")[0]) >= 9 && t !== "12:00" ? "AM" : "PM"}
            </span>
          ))}
        </div>
      </div>
      <div className={`${s.card} ${s.hours}`}>
        <strong>For 1 hour</strong>
        <span>
          <Round light>−</Round>1<Round light>+</Round>
        </span>
      </div>
      <div className={s.pay}>
        <span>
          <strong>₹1,200</strong>
          <small>Today, 6:00 PM · 1 hour</small>
        </span>
        <span className={`${s.pill} ${s.frost} ${s.big}`}>Hold for 10 minutes</span>
      </div>
    </div>
  );
}
