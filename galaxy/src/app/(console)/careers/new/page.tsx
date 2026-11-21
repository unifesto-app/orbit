import type { Metadata } from "next";
import { Container, PageHeader, ui } from "../../../ui";
import { OpeningForm } from "../form";

// A new opening. It's saved as whatever Status says (Draft unless changed), then opens on its own page.
export const metadata: Metadata = { title: "New opening" };

export default function NewOpening() {
  return (
    <div className={ui.page}>
      <PageHeader title="New opening" description="Write it as the site shows it. Keep it a draft until it reads right, then set it to Open." />
      <Container title="Opening">
        <OpeningForm id={null} />
      </Container>
    </div>
  );
}
