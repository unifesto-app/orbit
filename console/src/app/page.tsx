import ui from "./ui.module.css";

// Home. Filled in once sign-in lands: the hosts this person runs, then each host's events.
export default function Home() {
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>Home</h1>
        <p className={ui.secondary}>Run your hosts and their events on Orbit.</p>
      </header>
      <section className={ui.container}>
        <h2 className={ui.containerHeader}>Your hosts</h2>
        <div className={ui.containerBody}>
          <p className={ui.secondary}>The hosts you&apos;re on the team of will show here.</p>
        </div>
      </section>
    </div>
  );
}
