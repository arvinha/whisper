/**
 * Parts of the app that are switched off while the core (listen, prepare, answer) is made solid.
 * The code stays; set a flag to true to bring the part back.
 */
export const FEATURES = {
  /** Notes tab: summaries after a meeting, memory and "ask Aivia" requests. */
  notes: false,
  /** Calendar tab, reminders and the inbox of suggested events. */
  calendar: false,
} as const;
