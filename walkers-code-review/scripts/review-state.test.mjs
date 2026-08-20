import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./review-state.mjs", import.meta.url));
const checkpoints = fileURLToPath(new URL("../references/checkpoints.md", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function workspace() {
  return mkdtempSync(join(tmpdir(), "walkers-review-state-test-"));
}

function initialize(dir, extra = []) {
  const state = join(dir, "state.json");
  const result = run([
    "init", "--checkpoints", checkpoints, "--state", state,
    "--mode", "pr", "--scope", "test fixture", "--base", "HEAD~1",
    "--head", "HEAD", "--profiles", "web,api", ...extra,
  ]);
  assert.equal(result.status, 0, result.stderr);
  return state;
}

function parseOutput(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("complete lifecycle validates and exports all 39 checkpoints", () => {
  const dir = workspace();
  const state = initialize(dir);
  const initial = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(initial.checks.length, 39);
  assert.equal(initial.head, "HEAD");

  for (const check of initial.checks) {
    const recorded = run([
      "record", "--state", state, "--id", check.id, "--status", "pass",
      "--evidence", `${check.id}のコード経路、関連設定、回帰テストを読み、具体的な防御を確認した証拠です。`,
      "--notes", "",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
  }

  const validation = run(["validate", "--state", state]);
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(parseOutput(validation).valid, true);

  const output = join(dir, "coverage.md");
  const exported = run(["export", "--state", state, "--output", output]);
  assert.equal(exported.status, 0, exported.stderr);
  const markdown = readFileSync(output, "utf8");
  assert.match(markdown, /- Head: HEAD/);
  assert.match(markdown, /\| D1 \|/);
  assert.match(markdown, /pass=39/);
});

test("unknown and duplicate options fail instead of being ignored", () => {
  const dir = workspace();
  const unknown = run([
    "init", "--checkpoints", checkpoints, "--state", join(dir, "unknown.json"),
    "--mode", "pr", "--scope", "test", "--haed", "HEAD",
  ]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown option.*--haed/);

  const duplicate = run(["next", "--state", "one.json", "--state", "two.json"]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /duplicate option/);
});

test("missing checkpoint heading is rejected by the manifest", () => {
  const dir = workspace();
  const broken = join(dir, "broken-checkpoints.md");
  writeFileSync(broken, readFileSync(checkpoints, "utf8").replace("## D1 —", "### D1 —"));
  const result = run([
    "init", "--checkpoints", broken, "--state", join(dir, "state.json"),
    "--mode", "pr", "--scope", "test",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing=\[D1\]/);
});

test("corrupt states return structured invalid results without stack traces", () => {
  const dir = workspace();
  const baseState = initialize(dir);
  const base = JSON.parse(readFileSync(baseState, "utf8"));
  const cases = [
    { name: "null-checks", mutate: (state) => ({ ...state, checks: null }), problem: /checks must be an array/ },
    { name: "future-schema", mutate: (state) => ({ ...state, schemaVersion: 999 }), problem: /unsupported schemaVersion/ },
    { name: "bad-profiles", mutate: (state) => ({ ...state, profiles: "web" }), problem: /profiles must be an array/ },
    { name: "null-check", mutate: (state) => ({ ...state, checks: [null, ...state.checks.slice(1)] }), problem: /checks\[0\] must be an object/ },
  ];

  for (const item of cases) {
    const statePath = join(dir, `${item.name}.json`);
    writeFileSync(statePath, `${JSON.stringify(item.mutate(structuredClone(base)))}\n`);
    const result = run(["validate", "--state", statePath]);
    assert.equal(result.status, 2, `${item.name}: ${result.stderr}`);
    assert.doesNotMatch(result.stderr, /TypeError|at .*review-state/);
    const parsed = parseOutput(result);
    assert.equal(parsed.valid, false);
    assert.match(parsed.problems.join("\n"), item.problem);
    const exported = run(["export", "--state", statePath, "--output", join(dir, `${item.name}.md`)]);
    assert.equal(exported.status, 1);
    assert.doesNotMatch(exported.stderr, /TypeError|at .*review-state/);
  }
});

test("findings require severity and location", () => {
  const dir = workspace();
  const state = initialize(dir);
  const result = run([
    "record", "--state", state, "--id", "S4", "--status", "finding",
    "--severity", "High", "--evidence", "所有者条件のない更新経路をコード上で確認した具体的な証拠です。",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires --locations/);
});

test("Markdown export escapes pipes and newlines", () => {
  const dir = workspace();
  const state = initialize(dir);
  const result = run([
    "record", "--state", state, "--id", "D1", "--status", "finding",
    "--severity", "Low", "--locations", "src/file.js:1",
    "--evidence", "設定A|設定Bを比較し、\n差分があることをコードとテストで具体的に確認しました。",
    "--notes", "line1|line2",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = join(dir, "coverage.md");
  assert.equal(run(["export", "--state", state, "--output", output]).status, 0);
  const markdown = readFileSync(output, "utf8");
  assert.match(markdown, /設定A\\\|設定Bを比較し、 差分/);
  assert.match(markdown, /line1\\\|line2/);
});
