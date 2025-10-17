// =======================
// parser.gs – Discord message parsing logic (v2 parser for schedules, etc.)
// =======================

/** Parse a schedule message text (optionally with known `division`). */
function parseScheduleMessage_(text, hintDivision) {
  // This is a simplified parser for schedule messages.
  // It returns an object: { weekKey, pairs: [ { division, home, away, when, sourceLine } ], errors: [] }
  const out = { weekKey: '', pairs: [], errors: [] };
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l);
  for (let line of lines) {
    let division = String(hintDivision || '').trim();
    // If line starts with a division tag (like [Bronze]), override division
    const divMatch = line.match(/^\[([^\]]+)\]/);
    if (divMatch) {
      division = canonDivision_(divMatch[1]) || division;
      line = line.slice(divMatch[0].length).trim();
    }
    // Extract teams and when
    const m = line.match(/^(.+?)\s+vs\s+(.+?)\s+(.+)$/i);
    if (!m) {
      out.errors.push(`Unrecognized line format: "${line}"`);
      continue;
    }
    const homeRaw = m[1], awayRaw = m[2], whenRaw = m[3];
    // Strip any Discord user mentions or role mentions from team names
    const home = stripDiscordUsers_(homeRaw);
    const away = stripDiscordUsers_(awayRaw);
    // Parse the time/date from whenRaw (not implemented here; assume string as is)
    const whenText = whenRaw;
    // Add to output
    out.pairs.push({
      division: division,
      home: home,
      away: away,
      when: whenText,
      sourceLine: line
    });
  }
  // No specific weekKey logic here (could integrate date if needed)
  return out;
}

/** Remove Discord user or role mentions (e.g., "<@123456>") from a text. */
function stripDiscordUsers_(text) {
  return String(text || '').replace(/<@!?[0-9]+>/g, '').trim();
}