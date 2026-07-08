/**
 * Headless vision subagent runner.
 *
 * Each vision task is a separate `claude -p` process that reads one cropped
 * screenshot via its Read tool and returns a minified JSON verdict. The prompt
 * is written to STDIN (never passed as a CLI arg) to sidestep Windows .cmd
 * argument-quoting entirely. A bounded concurrency pool fans several out at
 * once — this is the "call subagents to run multi-threaded" requirement.
 */

import { spawn } from "child_process";

export type ClaudeCliResult = { ok: true; text: string } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 120000;

/**
 * The model name is the ONLY value interpolated into the shell command string
 * (the prompt goes via STDIN precisely to avoid this). `shell: true` is
 * required because `claude` is a .cmd shim on Windows, so the model MUST be
 * restricted to a safe charset — otherwise a caller-supplied model (e.g. the
 * public POST /jobs body.visionModel) is a shell-injection vector. Real model
 * ids ("sonnet", "claude-opus-4-8", "claude-haiku-4-5-20251001") all fit
 * [A-Za-z0-9._-]; anything else falls back to a safe default.
 */
const SAFE_MODEL_RE = /^[A-Za-z0-9._-]+$/;
export function isSafeModel(model: string): boolean {
  return typeof model === "string" && model.length > 0 && model.length <= 64 && SAFE_MODEL_RE.test(model);
}
function sanitizeModel(model: string): string {
  return isSafeModel(model) ? model : "sonnet";
}

/** Best-effort kill of the whole process tree (shell:true child is cmd.exe on Windows). */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    /* ignore */
  }
}

/**
 * Run one headless `claude -p` call. Resolves (never rejects): failures come
 * back as { ok: false, error }.
 */
export function runClaude(prompt: string, model: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ClaudeCliResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: ClaudeCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    let child: ReturnType<typeof spawn>;
    let timer: ReturnType<typeof setTimeout>;
    try {
      child = spawn(
        `claude -p --output-format json --model ${sanitizeModel(model)} --allowedTools Read`,
        { shell: true, windowsHide: true }
      );
    } catch (e) {
      // spawn can throw synchronously (OS resource exhaustion) — honor the
      // "resolves, never rejects" contract so the caller falls back cleanly.
      resolve({ ok: false, error: `spawn threw: ${String(e).slice(0, 200)}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    timer = setTimeout(() => {
      killTree(child.pid);
      finish({ ok: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on("error", (e) => finish({ ok: false, error: `spawn error: ${String(e).slice(0, 300)}` }));

    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false, error: `exit ${code}: ${stderr.trim().slice(-300)}` });
        return;
      }
      let env: unknown;
      try {
        env = JSON.parse(stdout);
      } catch {
        finish({ ok: false, error: `unparseable envelope: ${stdout.trim().slice(-300)}` });
        return;
      }
      const e = env as { is_error?: boolean; subtype?: string; result?: unknown };
      if (e && e.is_error === false && typeof e.result === "string") {
        finish({ ok: true, text: e.result });
      } else {
        finish({ ok: false, error: `cli error (${e && e.subtype}): ${stderr.trim().slice(-200)}` });
      }
    });

    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      killTree(child.pid);
      finish({ ok: false, error: "no stdin on child process" });
    }
  });
}

/** Run `fn` over items with at most `n` concurrent, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(n) || 1);
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
