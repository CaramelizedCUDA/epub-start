// Shared across Reader remounts: an older retry must not overwrite a newer save
// or recreate a single-book override after a clear operation.
let settingsWrites: Promise<unknown> = Promise.resolve();

export function queueSettingsWrite<T>(write: () => Promise<T>): Promise<T> {
  const run = settingsWrites.then(write);
  // Keep a settled tail so one failed operation never poisons the next action.
  settingsWrites = run.catch(() => undefined);
  return run;
}
