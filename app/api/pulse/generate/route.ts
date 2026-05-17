import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function POST() {
  const script = path.resolve(process.cwd(), "scripts", "generate-pulse.ts");
  const proc = spawn("npx", ["tsx", script], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  return NextResponse.json({ ok: true, pid: proc.pid });
}
