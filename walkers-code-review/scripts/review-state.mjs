#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const VALID_MODES = new Set(["pr", "full", "security", "release"]);
const VALID_STATUSES = new Set(["pending", "pass", "finding", "na", "blocked"]);
const VALID_SEVERITIES = new Set(["Critical", "High", "Medium", "Low"]);
const EXPECTED_CHECKPOINT_IDS = [
  "D1", "D2", "D3", "D4", "D5",
  "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8",
  "T1", "T2", "T3", "T4",
  "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8",
];
const ALLOWED_ARGS = {
  init: new Set(["checkpoints", "state", "mode", "scope", "base", "head", "profiles"]),
  next: new Set(["state"]),
  record: new Set(["state", "id", "status", "severity", "locations", "evidence", "notes"]),
  summary: new Set(["state"]),
  validate: new Set(["state"]),
  export: new Set(["state", "output"]),
};

function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) fail("command is required: init | next | record | summary | validate | export");
  if (!(command in ALLOWED_ARGS)) fail(`unknown command: ${command}`);
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!ALLOWED_ARGS[command].has(key)) fail(`unknown option for ${command}: --${key}`);
    if (key in args) fail(`duplicate option: --${key}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return { command, args };
}

function requireArg(args, name) {
  const value = args[name];
  if (!value) fail(`--${name} is required`);
  return value;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read state ${file}: ${error.message}`);
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function parseCheckpoints(file) {
  let markdown;
  try {
    markdown = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(`cannot read checkpoints ${file}: ${error.message}`);
  }
  const checks = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^## ([A-Z]\d+) — (.+)$/);
    if (match) checks.push({ id: match[1], title: match[2].trim() });
  }
  if (!checks.length) fail(`no checkpoint headings found in ${file}`);
  const duplicates = checks.filter((check, index) => checks.findIndex((x) => x.id === check.id) !== index);
  if (duplicates.length) fail(`duplicate checkpoint ids: ${[...new Set(duplicates.map((x) => x.id))].join(", ")}`);
  const actualIds = checks.map((check) => check.id);
  const missing = EXPECTED_CHECKPOINT_IDS.filter((id) => !actualIds.includes(id));
  const extra = actualIds.filter((id) => !EXPECTED_CHECKPOINT_IDS.includes(id));
  if (missing.length || extra.length) {
    fail(`checkpoint manifest mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
  }
  if (actualIds.some((id, index) => id !== EXPECTED_CHECKPOINT_IDS[index])) {
    fail("checkpoint order does not match the required manifest");
  }
  return checks;
}

function stateStructureProblems(state) {
  const problems = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) return ["state root must be an object"];
  if (state.schemaVersion !== 1) problems.push(`unsupported schemaVersion: ${state.schemaVersion}`);
  for (const key of ["startedAt", "updatedAt", "scope", "base", "head", "checkpointsSource"]) {
    if (typeof state[key] !== "string" || !state[key].trim()) problems.push(`${key} must be a non-empty string`);
  }
  if (!VALID_MODES.has(state.mode)) problems.push(`invalid mode: ${state.mode}`);
  if (!Array.isArray(state.profiles) || state.profiles.some((item) => typeof item !== "string")) {
    problems.push("profiles must be an array of strings");
  }
  if (!Array.isArray(state.checks)) return ["checks must be an array"];
  const ids = [];
  state.checks.forEach((check, index) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      problems.push(`checks[${index}] must be an object`);
      return;
    }
    if (typeof check.id !== "string" || !check.id) problems.push(`checks[${index}].id must be a non-empty string`);
    else ids.push(check.id);
    if (typeof check.title !== "string" || !check.title.trim()) problems.push(`${check.id ?? index}: title must be a non-empty string`);
    if (typeof check.status !== "string") problems.push(`${check.id ?? index}: status must be a string`);
    if (check.severity !== null && typeof check.severity !== "string") problems.push(`${check.id ?? index}: severity must be null or a string`);
    if (!Array.isArray(check.locations) || check.locations.some((item) => typeof item !== "string")) {
      problems.push(`${check.id ?? index}: locations must be an array of strings`);
    }
    if (typeof check.evidence !== "string") problems.push(`${check.id ?? index}: evidence must be a string`);
    if (typeof check.notes !== "string") problems.push(`${check.id ?? index}: notes must be a string`);
    if (check.updatedAt !== null && typeof check.updatedAt !== "string") {
      problems.push(`${check.id ?? index}: updatedAt must be null or a string`);
    }
  });
  const missing = EXPECTED_CHECKPOINT_IDS.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !EXPECTED_CHECKPOINT_IDS.includes(id));
  if (missing.length) problems.push(`missing checkpoint ids: ${missing.join(", ")}`);
  if (extra.length) problems.push(`unknown checkpoint ids: ${extra.join(", ")}`);
  if (ids.length !== new Set(ids).size) problems.push("duplicate checkpoint ids");
  if (ids.some((id, index) => id !== EXPECTED_CHECKPOINT_IDS[index])) problems.push("checkpoint order is invalid");
  return problems;
}

function requireOperationalState(state) {
  const problems = stateStructureProblems(state);
  if (problems.length) fail(`invalid state: ${problems.join("; ")}`);
}

function init(args) {
  const checkpoints = requireArg(args, "checkpoints");
  const stateFile = requireArg(args, "state");
  const mode = requireArg(args, "mode");
  if (!VALID_MODES.has(mode)) fail(`invalid mode: ${mode}`);
  if (fs.existsSync(stateFile)) fail(`state already exists: ${stateFile}`);
  const now = new Date().toISOString();
  const state = {
    schemaVersion: 1,
    startedAt: now,
    updatedAt: now,
    mode,
    scope: requireArg(args, "scope"),
    base: args.base ?? "not-specified",
    head: args.head ?? "working-tree",
    profiles: (args.profiles ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    checkpointsSource: path.resolve(checkpoints),
    checks: parseCheckpoints(checkpoints).map((check) => ({
      ...check,
      status: "pending",
      severity: null,
      locations: [],
      evidence: "",
      notes: "",
      updatedAt: null,
    })),
  };
  writeJson(stateFile, state);
  process.stdout.write(`${JSON.stringify({ state: path.resolve(stateFile), checks: state.checks.length, mode }, null, 2)}\n`);
}

function next(args) {
  const state = readJson(requireArg(args, "state"));
  requireOperationalState(state);
  const check = state.checks.find((item) => item.status === "pending");
  process.stdout.write(`${JSON.stringify(check ?? { done: true }, null, 2)}\n`);
}

function record(args) {
  const stateFile = requireArg(args, "state");
  const state = readJson(stateFile);
  requireOperationalState(state);
  const id = requireArg(args, "id");
  const status = requireArg(args, "status");
  const evidence = requireArg(args, "evidence").trim();
  if (!VALID_STATUSES.has(status) || status === "pending") fail(`invalid record status: ${status}`);
  if (evidence.length < 30) fail("--evidence must contain at least 30 characters of concrete evidence");
  const check = state.checks.find((item) => item.id === id);
  if (!check) fail(`unknown checkpoint id: ${id}`);
  if (status === "finding") {
    if (!VALID_SEVERITIES.has(args.severity)) fail("finding requires --severity Critical|High|Medium|Low");
    if (!args.locations) fail("finding requires --locations path:line[,path:line]");
  } else if (args.severity) {
    fail("--severity is only valid for finding");
  }
  check.status = status;
  check.severity = status === "finding" ? args.severity : null;
  check.locations = args.locations ? args.locations.split(",").map((x) => x.trim()).filter(Boolean) : [];
  check.evidence = evidence;
  check.notes = (args.notes ?? "").trim();
  check.updatedAt = new Date().toISOString();
  state.updatedAt = check.updatedAt;
  writeJson(stateFile, state);
  process.stdout.write(`${JSON.stringify(check, null, 2)}\n`);
}

function counts(state) {
  const result = { pending: 0, finding: 0, pass: 0, na: 0, blocked: 0 };
  const severities = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const check of Array.isArray(state?.checks) ? state.checks : []) {
    if (!check || typeof check !== "object" || !(check.status in result)) continue;
    result[check.status] += 1;
    if (check.status === "finding" && check.severity in severities) severities[check.severity] += 1;
  }
  return { statuses: result, severities };
}

function summary(args) {
  const state = readJson(requireArg(args, "state"));
  requireOperationalState(state);
  process.stdout.write(`${JSON.stringify({ ...counts(state), mode: state.mode, scope: state.scope }, null, 2)}\n`);
}

function validateState(state) {
  const problems = stateStructureProblems(state);
  if (!state || typeof state !== "object" || Array.isArray(state)) return problems;
  if (!Array.isArray(state.checks)) return problems;
  for (const check of state.checks) {
    if (!check || typeof check !== "object") {
      problems.push("check entry must be an object");
      continue;
    }
    if (!VALID_STATUSES.has(check.status)) problems.push(`${check.id}: invalid status`);
    if (check.status === "pending") problems.push(`${check.id}: pending`);
    if (check.status !== "pending" && String(check.evidence ?? "").trim().length < 30) {
      problems.push(`${check.id}: evidence is too short`);
    }
    if (check.status === "finding") {
      if (!VALID_SEVERITIES.has(check.severity)) problems.push(`${check.id}: invalid severity`);
      if (!Array.isArray(check.locations) || !check.locations.length) problems.push(`${check.id}: location is missing`);
    } else if (check.severity !== null) {
      problems.push(`${check.id}: severity must be null unless status is finding`);
    }
    if (check.status !== "pending" && typeof check.updatedAt !== "string") problems.push(`${check.id}: updatedAt is missing`);
  }
  return problems;
}

function validate(args) {
  const state = readJson(requireArg(args, "state"));
  const problems = validateState(state);
  const result = { valid: problems.length === 0, problems, ...counts(state) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (problems.length) process.exit(2);
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function exportMarkdown(args) {
  const state = readJson(requireArg(args, "state"));
  requireOperationalState(state);
  const output = requireArg(args, "output");
  const totals = counts(state);
  const lines = [
    "# Code review coverage",
    "",
    `- Mode: ${state.mode}`,
    `- Scope: ${state.scope}`,
    `- Base: ${state.base}`,
    `- Head: ${state.head}`,
    `- Profiles: ${state.profiles.join(", ") || "none"}`,
    `- Updated: ${state.updatedAt}`,
    `- Status: ${Object.entries(totals.statuses).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    `- Severity: ${Object.entries(totals.severities).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    "",
    "| ID | Checkpoint | Status | Severity | Locations | Evidence | Notes |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const check of state.checks) {
    lines.push(`| ${check.id} | ${escapeCell(check.title)} | ${check.status} | ${check.severity ?? ""} | ${escapeCell(check.locations.join(", "))} | ${escapeCell(check.evidence)} | ${escapeCell(check.notes)} |`);
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${lines.join("\n")}\n`);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(output), ...totals }, null, 2)}\n`);
}

const { command, args } = parseArgs(process.argv.slice(2));
if (command === "init") init(args);
else if (command === "next") next(args);
else if (command === "record") record(args);
else if (command === "summary") summary(args);
else if (command === "validate") validate(args);
else if (command === "export") exportMarkdown(args);
