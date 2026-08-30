import { log } from "@/lib/logger"

type TimingEntry = { startedAt: number; durationMs?: number }

function nowMs(): number {
  return performance.now()
}

function headerToken(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)
}

export class RequestTimings {
  private readonly startedAt = nowMs()
  private readonly entries = new Map<string, TimingEntry>()
  private logged = false

  start(name: string): () => void {
    const entry: TimingEntry = { startedAt: nowMs() }
    this.entries.set(name, entry)
    return () => {
      if (entry.durationMs === undefined) {
        entry.durationMs = Math.max(0, nowMs() - entry.startedAt)
      }
    }
  }

  async measure<T>(
    name: string,
    operation: () => PromiseLike<T>,
  ): Promise<T> {
    const finish = this.start(name)
    try {
      return await operation()
    } finally {
      finish()
    }
  }

  snapshot(): Record<string, number> {
    const output: Record<string, number> = {
      total: Math.max(0, nowMs() - this.startedAt),
    }
    for (const [name, entry] of this.entries) {
      const duration =
        entry.durationMs ?? Math.max(0, nowMs() - entry.startedAt)
      output[name] = Number(duration.toFixed(1))
    }
    output.total = Number(output.total.toFixed(1))
    return output
  }

  serverTimingHeader(): string {
    return Object.entries(this.snapshot())
      .map(([name, duration]) => `${headerToken(name)};dur=${duration}`)
      .join(", ")
  }

  logOnce(context: {
    requestId?: string
    projectId?: string
    sessionId?: string
  }): void {
    if (this.logged) return
    this.logged = true
    log.info("request_timing", {
      ...context,
      timingsMs: this.snapshot(),
    })
  }
}

export function shouldExposeServerTimings(): boolean {
  return process.env.NODE_ENV !== "production"
}
