import ui from "../ui.module.css";

// Home, for everyone who runs or helps run something on Orbit (owner, 21 Nov 2026): Admins of a host of any kind
// (organisers, venues, performers, fests), Desk at a venue, and Event leads and Crew on one event (roles by use case,
// 21 Nov 2026). Judges never come here: they score by a link. Next it lists what this person is on, from /me.
export default function Home() {
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>Home</h1>
        <p className={ui.secondary}>Everything you run or help run on Orbit.</p>
      </header>
      <section className={ui.container}>
        <h2 className={ui.containerHeader}>Your teams</h2>
        <div className={ui.containerBody}>
          <p className={ui.secondary}>When a host adds you to its team, or to one of its events as Event lead or Crew, it shows here.</p>
        </div>
      </section>
    </div>
  );
}
