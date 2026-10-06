import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeAdapter, parseDisplay, RewriteError, runClaude, type Display } from "./adapter";

const directories: string[] = [];
const display: Display = { title: "Investigate the reconnect", summary: "Reconnection may be failing; the evidence is incomplete.", steps: ["Compare server events and browser events."], nextAction: "Check the browser event log.", uncertainty: "The cause is unconfirmed." };
const input = { original: "Reconnection may be failing. Compare the logs next; the cause is unconfirmed.", thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true };
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "thought-adapter-test-"));
  directories.push(repoRoot);
  const promptFile = join(repoRoot, "style.md");
  await Bun.write(promptFile, "Use simple language. Preserve meaning. Keep the answer brief.");
  return { repoRoot, promptFile };
}

describe("Claude rewrite adapter", () => {
  test("uses the actual prompt, structured output, isolated CLI configuration and untrusted source envelope", async () => {
    const paths = await fixture();
    let command: string[] = [];
    let options: any;
    const adapter = createClaudeAdapter({ ...paths, command: "claude", runner: async (args, settings) => { command = args; options = settings; return { exitCode: 0, stdout: JSON.stringify({ structured_output: display, is_error: false }) }; } });
    expect(await adapter.transform(input)).toEqual(display);
    expect(command).toContain("--safe-mode");
    expect(command[command.indexOf("--tools") + 1]).toBe("");
    expect(command).toContain("--strict-mcp-config");
    expect(command[command.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect(command).toContain("--no-session-persistence");
    expect(command).toContain("--json-schema");
    const prompt = command[command.indexOf("--system-prompt") + 1];
    expect(prompt).toContain("Use simple language. Preserve meaning.");
    expect(prompt).toContain("untrusted source material");
    expect(prompt).toContain("hypothesis into a fact");
    expect(JSON.parse(options.input).note.original).toBe(input.original);
    expect(options.cwd).toBe(join(paths.repoRoot, ".local/adapter"));
    expect(options.timeoutMs).toBe(90_000);
    expect(options.maxOutputBytes).toBe(1_000_000);
  });

  test("honors model overrides and can parse the CLI result envelope", async () => {
    const paths = await fixture();
    let command: string[] = [];
    const adapter = createClaudeAdapter({ ...paths, command: "claude", model: "configured-model", runner: async args => { command = args; return { exitCode: 0, stdout: JSON.stringify({ result: JSON.stringify(display) }) }; } });
    expect(await adapter.transform(input)).toEqual(display);
    expect(command[command.indexOf("--model") + 1]).toBe("configured-model");
  });

  test("does not expose provider failures and never fabricates a fallback rewrite", async () => {
    const paths = await fixture();
    const adapter = createClaudeAdapter({ ...paths, command: "claude", runner: async () => ({ exitCode: 1, stdout: "secret-account-email-or-provider-token" }) });
    try { await adapter.transform(input); throw new Error("Expected failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(RewriteError);
      expect((error as Error).message).toContain("original note");
      expect((error as Error).message).not.toContain("secret-account");
    }
    const badJson = createClaudeAdapter({ ...paths, command: "claude", runner: async () => ({ exitCode: 0, stdout: "not json" }) });
    await expect(badJson.transform(input)).rejects.toThrow("invalid response");
    const malformed = createClaudeAdapter({ ...paths, command: "claude", runner: async () => ({ exitCode: 0, stdout: JSON.stringify({ structured_output: { title: "not complete" } }) }) });
    await expect(malformed.transform(input)).rejects.toThrow("invalid response");
  });

  test("rejects oversized or missing display fields", () => {
    expect(() => parseDisplay({ ...display, title: "x".repeat(121) })).toThrow();
    expect(() => parseDisplay({ ...display, steps: Array(6).fill("step") })).toThrow();
    expect(() => parseDisplay({ ...display, nextAction: undefined })).toThrow();
    expect(() => parseDisplay({ ...display, uncertainty: " " })).toThrow();
    expect(() => parseDisplay(null)).toThrow();
  });

  test("kills subprocesses that time out or exceed the output limit", async () => {
    const paths = await fixture();
    await expect(runClaude([process.execPath, "-e", "setInterval(() => {}, 1000)"], { cwd: paths.repoRoot, input: "data", timeoutMs: 30, maxOutputBytes: 1000 })).rejects.toThrow("timed out");
    await expect(runClaude([process.execPath, "-e", "console.log('x'.repeat(2000))"], { cwd: paths.repoRoot, input: "data", timeoutMs: 1000, maxOutputBytes: 1000 })).rejects.toThrow("response limit");
  });
});
