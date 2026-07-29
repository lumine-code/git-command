function parseCommandLine(input) {
  const source = String(input || "");
  const args = [];
  let value = "";
  let quote = null;
  let tokenStarted = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (character === "\\" && quote === '"') {
        const next = source[index + 1];
        if (next === '"' || next === "\\" || /\s/.test(next || "")) {
          value += next;
          index++;
        } else {
          value += character;
        }
        tokenStarted = true;
        continue;
      }
      value += character;
      tokenStarted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (character === "\\") {
      const next = source[index + 1];
      if (next === "'" || next === '"' || next === "\\" || /\s/.test(next || "")) {
        value += next;
        index++;
      } else {
        value += character;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(value);
        value = "";
        tokenStarted = false;
      }
      continue;
    }

    value += character;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error(`Unterminated ${quote === "'" ? "single" : "double"} quote.`);
  }
  if (tokenStarted) args.push(value);
  return args;
}

module.exports = { parseCommandLine };
