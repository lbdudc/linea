const CONCURRENCY = 4;

/**
 * Where a package is used: of `lines`, the ones whose manifest asks for `location` directly or whose lock pins it (it is then needed
 * by another package). `pinsOf(line)` gives what a line pins (`ModularService.linePins`); a line that cannot be read is counted in `unreadable`.
 * Each use says the range asked for (`null` when the package comes in through another one), the version it resolved to and the
 * products of the line, which are made with those versions.
 */
export const usageOf = async ({ location, lines, pinsOf }) => {
  const found = [];
  let unreadable = 0;
  // (every line is read: the kind stored for one can be out of date, and a plain line is told by what its manifest says)
  let next = 0;
  const worker = async () => {
    while (next < lines.length) {
      const line = lines[next++];
      let pins;
      try {
        pins = await pinsOf(line);
      } catch {
        // a line that cannot be read now (the host failed, access was lost) is counted, not hidden
        unreadable++;
        continue;
      }
      if (!pins) continue;
      const range = pins.modules[location] ?? pins.metamodels[location] ?? null;
      const locked = pins.locked[location] ?? null;
      if (range === null && !locked) continue;
      found.push({
        id: pins.id, name: pins.name, kind: pins.kind, lineVersion: pins.version,
        direct: range !== null, range, version: locked?.version ?? null, products: pins.products,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));
  return { location, unreadable, lines: found.sort((a, b) => a.name.localeCompare(b.name)) };
};
