// User input error - the caller (index.js) prints only the message, no stack, and exits 1.
// Core modules throw it too, so it lives in core rather than cli (avoids a core -> cli back-reference).
export class CliError extends Error {}
