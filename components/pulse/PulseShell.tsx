import type { ReactNode } from "react";

interface ShellProps {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

export function PulseShell({ sidebar, header, children }: ShellProps) {
  return (
    <div className="pulse-page min-h-screen">
      <div className="border-b border-parchment-dark px-6 py-4">{header}</div>
      <div className="flex">
        <aside className="w-56 shrink-0 border-r border-parchment-dark px-4 py-6 sticky top-0 h-[calc(100vh-4rem)] overflow-y-auto">
          {sidebar}
        </aside>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
