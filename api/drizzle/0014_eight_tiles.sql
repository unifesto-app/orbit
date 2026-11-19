-- The eight Discover tiles replace the ten categories (Discover flow; owner, 19 Nov 2026: "The eight tiles"). Stored
-- events move to the new slugs: Music becomes Jams; Workshops, Film and Startups go under Events. Comedy, Meetups,
-- Hackathons, Fests, Gaming and Sports keep theirs. Safe to run twice: rows already moved match nothing.
UPDATE "events"
SET "category" = CASE "category"
  WHEN 'music' THEN 'jams'
  WHEN 'workshops' THEN 'events'
  WHEN 'film' THEN 'events'
  WHEN 'startups' THEN 'events'
END
WHERE "category" IN ('music', 'workshops', 'film', 'startups');
