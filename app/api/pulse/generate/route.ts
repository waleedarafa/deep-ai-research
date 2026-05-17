import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function POST() {
  const script = path.resolve(process.cwd(), "scripts", "generate-pulse.ts");
  const proc = spawn("npx", ["tsx", script], {
    cwd: process.cwd(),
    env: process.env, // intentional: child needs ANTHROPIC_API_KEY + EXA_API_KEY
    detached: true,
    stdio: "ignore",
  });

  let spawnError: Error | null = null;
  proc.on("error", (err) => {
    spawnError = err;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (spawnError) {
    return NextResponse.json({ error: (spawnError as Error).message }, { status: 500 });
  }
  proc.unref();
  return NextResponse.json({ ok: true, pid: proc.pid });
}
