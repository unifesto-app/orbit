import ui from "../ui.module.css";

// Home, for everyone who runs or helps run something on Orbit (owner, 21 Nov 2026): Admins of a host of any kind
// (organisers, venues, performers, fests), and Curators, Co-curators, Crew and Judges on one event. Next it lists what
// this person is on, from /me's teams and event roles.
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
          <p className={ui.secondary}>When a host adds you to its team, or to an event as Curator, Crew or Judge, it shows here.</p>
        </div>
      </section>
    </div>
  );
}
