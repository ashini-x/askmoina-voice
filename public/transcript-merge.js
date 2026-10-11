(function (root) {
  "use strict";

  function comparisonToken(token) {
    return String(token || "").replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").toLocaleLowerCase();
  }

  function sameToken(left, right) {
    const a = comparisonToken(left);
    const b = comparisonToken(right);
    return a && b ? a === b : left === right;
  }

  function startsWithTokens(shorter, longer) {
    return shorter.length <= longer.length &&
      shorter.every((token, index) => sameToken(token, longer[index]));
  }

  // Merge cumulative partials and short fragments without repeating shared words.
  function merge(existingText, incomingText) {
    const current = String(existingText || "").trim().replace(/\s+/g, " ");
    const incoming = String(incomingText || "").trim().replace(/\s+/g, " ");
    if (!current) return incoming;
    if (!incoming) return current;

    const currentTokens = current.split(" ");
    const incomingTokens = incoming.split(" ");
    if (startsWithTokens(currentTokens, incomingTokens)) return incoming;
    if (startsWithTokens(incomingTokens, currentTokens)) return current;

    const maxOverlap = Math.min(currentTokens.length, incomingTokens.length, 24);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      const currentSuffix = currentTokens.slice(-overlap);
      const incomingPrefix = incomingTokens.slice(0, overlap);
      if (currentSuffix.every((token, index) => sameToken(token, incomingPrefix[index]))) {
        return currentTokens.concat(incomingTokens.slice(overlap)).join(" ");
      }
    }
    return current + " " + incoming;
  }

  root.AskMoinaTranscript = Object.freeze({ merge });
})(globalThis);
