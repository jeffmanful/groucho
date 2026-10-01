import { createHash } from "node:crypto"
import { NARROW_CASES } from "@/evals/jev-narrow-cases"
import { COVERAGE_THRESHOLD, coverageCounts, narrowQuestions, readFacts, sameSet } from "@/evals/jev-narrow-evaluation"
import { buildJevTurnRoutingQuestions } from "@/lib/jev-turn-routing-evaluation"
import { evaluateJevSystemOne, OPENROUTER_JEV_SHADOW_ENDPOINT, OPENROUTER_JEV_SHADOW_MODEL } from "@/lib/jev-shadow-evaluation"

function percentile(values: number[], fraction: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const low = Math.floor(position)
  return Math.round((sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)) * 10) / 10
}

type Result = {
  caseId: string
  arm: "baseline" | "narrow"
  latencyMs: number
  model: string
  cost: number | null
  inputTokens: number
  outputTokens: number
  facts: ReturnType<typeof readFacts>
  conservativeFacts: ReturnType<typeof readFacts>
}

async function main() {
  const contract = NARROW_CASES.map((item) => ({ ...item,
    baselineQuestions: buildJevTurnRoutingQuestions(item.state),
    narrowQuestions: narrowQuestions(item.state),
  }))
  const digest = createHash("sha256").update(JSON.stringify(contract)).digest("hex")
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ cases: NARROW_CASES.length, requests: 100, contractSha256: digest,
      coverageThreshold: COVERAGE_THRESHOLD, databaseWrites: 0, syntheticOnly: true,
      baselineQuestions: Object.keys(contract[0].baselineQuestions).length,
      narrowQuestions: Object.keys(contract[0].narrowQuestions).length,
    }, null, 2))
    return
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required")
  const results: Result[] = []
  const errors: Array<{caseId: string; arm: string; error: string}> = []
  for (const [index, item] of NARROW_CASES.entries()) {
    // Counterbalance order; the two arms see exactly the same state.
    const order: Result["arm"][] = index % 2 ? ["narrow", "baseline"] : ["baseline", "narrow"]
    for (const arm of order) {
      try {
        const result = await evaluateJevSystemOne({
          apiKey, state: item.state,
          questions: arm === "narrow" ? narrowQuestions(item.state) : buildJevTurnRoutingQuestions(item.state),
          endpoint: OPENROUTER_JEV_SHADOW_ENDPOINT, model: OPENROUTER_JEV_SHADOW_MODEL,
        })
        results.push({
          caseId: item.id, arm, latencyMs: result.latencyMs, model: result.response.model,
          cost: result.response.usage.cost ?? null,
          inputTokens: result.response.usage.input_tokens, outputTokens: result.response.usage.output_tokens,
          facts: readFacts(result.response, arm === "narrow", arm === "narrow" ? COVERAGE_THRESHOLD : 0.5),
          conservativeFacts: readFacts(result.response, arm === "narrow", COVERAGE_THRESHOLD),
        })
      } catch (error) {
        errors.push({ caseId: item.id, arm, error: error instanceof Error ? error.message : "Request failed" })
      }
    }
    if ((index + 1) % 10 === 0) process.stderr.write(`Completed ${index + 1}/${NARROW_CASES.length} paired cases\n`)
  }
  function summary(arm: Result["arm"], conservative = false) {
    const subset = results.filter((result) => result.arm === arm)
    let tp = 0, fp = 0, fn = 0, exact = 0, riskExact = 0, repairExact = 0, multiExact = 0
    const mismatches: unknown[] = []
    for (const row of subset) {
      const expected = NARROW_CASES.find((item) => item.id === row.caseId)!
      const facts = conservative ? row.conservativeFacts : row.facts
      const counts = coverageCounts(expected.coverage, facts.coverage)
      tp += counts.tp; fp += counts.fp; fn += counts.fn
      const matches = { coverage: sameSet(expected.coverage, facts.coverage), risks: sameSet(expected.risks, facts.risks), repair: expected.repair === facts.repair }
      exact += Number(matches.coverage); riskExact += Number(matches.risks); repairExact += Number(matches.repair)
      multiExact += Number(matches.coverage && expected.coverage.length > 1)
      if (Object.values(matches).some((value) => !value)) mismatches.push({ caseId: row.caseId, matches })
    }
    return {
      completed: subset.length, expected: NARROW_CASES.length, tp, fp, fn,
      precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
      coverageExact: exact, riskExact, repairExact, multiExact,
      multiExpected: NARROW_CASES.filter((item) => item.coverage.length > 1).length,
      latencyMs: { p50: percentile(subset.map((row) => row.latencyMs), 0.5), p95: percentile(subset.map((row) => row.latencyMs), 0.95), first: subset[0]?.latencyMs },
      inputTokens: subset.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: subset.reduce((sum, row) => sum + row.outputTokens, 0),
      cost: subset.every((row) => row.cost !== null) ? subset.reduce((sum, row) => sum + row.cost!, 0) : null,
      mismatches,
    }
  }
  const pairedDeltas = NARROW_CASES.flatMap((item) => {
    const baseline = results.find((row) => row.caseId === item.id && row.arm === "baseline")
    const narrow = results.find((row) => row.caseId === item.id && row.arm === "narrow")
    return baseline && narrow ? [narrow.latencyMs - baseline.latencyMs] : []
  })
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), contractSha256: digest,
    syntheticOnly: true, productionWrites: 0, baseline: summary("baseline"),
    baselineAt075: summary("baseline", true), narrow: summary("narrow"),
    pairedLatencyDeltaMedianMs: percentile(pairedDeltas, 0.5), errors, results,
  }, null, 2))
  if (errors.length) process.exitCode = 1
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Experiment failed"); process.exitCode = 1 })
