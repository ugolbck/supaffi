// Fills every hook a build did not set with its default, one group at a time.
// A key a build sets to undefined counts as not set, so a half-written
// override can never leave a hook missing at runtime.
export function mergeExtensions<T extends Record<string, object>>(
  defaults: T,
  installed: { [K in keyof T]?: Partial<T[K]> }
): T {
  const merged = {} as T;
  for (const group of Object.keys(defaults) as (keyof T)[]) {
    const overrides = Object.entries(installed[group] ?? {}).filter(([, value]) => value !== undefined);
    merged[group] = { ...defaults[group], ...Object.fromEntries(overrides) };
  }
  return merged;
}
