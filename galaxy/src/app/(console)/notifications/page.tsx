import { CHANNELS, type Channel, type GalaxyKinds, type KillSwitch } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { me, read } from "../../../api";
import { Alert, Badge, Container, ui } from "../../ui";
import { Act } from "../act";
import { time } from "../requests/status";
import { setSwitch } from "./actions";
import { CHANNEL_NAMES, GROUPS, kindName, NotificationsHeader } from "./tabs";

// Notifications › Kinds (notifications build plan, PR 7; API: GET /galaxy/notifications/kinds, PUT …/switches): every
// kind in the catalog by group, and Galaxy's kill switch per channel. Holders of Platform switch; People only read.
// Must kinds have no switch of their own; the whole-channel switch stops them too.
export const metadata: Metadata = { title: "Notifications" };

const LEVELS = { must: "Must", normal: "Normal", low: "Low" } as const;

export default function Kinds() {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="kinds" description="Every message Orbit sends, and its switch per channel. A switch takes hold on the next send." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const [r, who] = await Promise.all([read<GalaxyKinds>("/galaxy/notifications/kinds"), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const can = who.ok && !!who.data.staff?.features.includes("platform");
  return (
    <>
      <Container title="Whole channel">
        <p className={ui.secondary}>Stops every kind on that channel, Must kinds too, but never Galaxy staff emails. For when a provider is broken.</p>
        <table className={ui.table}>
          <thead>
            <tr>
              {CHANNELS.map((ch) => (
                <th key={ch}>{CHANNEL_NAMES[ch]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {CHANNELS.map((ch) => (
                <td key={ch}>
                  <Switch kind="*" channel={ch} off={r.data.all[ch]} can={can} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Container>
      {GROUPS.map(([group, title]) => {
        const kinds = r.data.kinds.filter((k) => k.group === group);
        return (
          <Container key={group} title={title} count={kinds.length}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Level</th>
                  {CHANNELS.map((ch) => (
                    <th key={ch}>{CHANNEL_NAMES[ch]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kinds.map((k) => (
                  <tr key={k.kind}>
                    <td>{kindName(k.kind)}</td>
                    <td>{LEVELS[k.level]}</td>
                    {CHANNELS.map((ch) => (
                      <td key={ch}>
                        {!k.channels.includes(ch) ? (
                          <span className={ui.secondary}>–</span>
                        ) : r.data.all[ch] && !(ch === "email" && k.group === "staff") ? (
                          // The whole channel is off (staff emails always try: api/src/notifications.ts, stops).
                          <Badge tone="error">Off (whole channel)</Badge>
                        ) : k.level === "must" ? (
                          <span className={ui.secondary}>Always on</span>
                        ) : (
                          <Switch kind={k.kind} channel={ch} off={k.off[ch]} can={can} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Container>
        );
      })}
    </>
  );
}

// One switch: its state, who switched it off and why, and for Platform the button that flips it with a reason.
function Switch({ kind, channel, off, can }: { kind: string; channel: Channel; off?: KillSwitch; can: boolean }) {
  return (
    <div className={ui.row}>
      {off ? <Badge tone="error">Off</Badge> : <Badge tone="success">On</Badge>}
      {off && (
        <span className={ui.secondary} title={off.reason}>
          {off.by ?? "Staff"}, {time(off.at)}
        </span>
      )}
      {can && (
        <Act
          label={off ? "Switch on" : "Switch off"}
          action={setSwitch}
          hidden={{ kind, channel, off: off ? "false" : "true" }}
          who="Everyone with Platform sees this"
        />
      )}
    </div>
  );
}
