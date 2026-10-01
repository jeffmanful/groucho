import {
  JEV_TURN_ROUTING_CASES,
  JEV_TURN_SIGNALS,
} from "@/evals/jev-turn-routing-cases"
import {
  buildJevTurnRoutingQuestions,
  evaluateJevTurnRouting,
  interpretJevTurnRoutingResponse,
  turnRoutingState,
  type JevTurnRoutingReadout,
} from "@/lib/jev-turn-routing-evaluation"
import {
  JEV_SHADOW_ENDPOINT,
  JEV_SHADOW_MODEL,
  OPENROUTER_JEV_SHADOW_ENDPOINT,
  OPENROUTER_JEV_SHADOW_MODEL,
} from "@/lib/jev-shadow-evaluation"

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function rounded(value: number | null, digits = 1): number | null {
  if (value === null) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

type RoutingResult = {
  caseId: string
  latencyMs: number
  model: string
  routedProvider: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  expected: (typeof JEV_TURN_ROUTING_CASES)[number]["expected"]
  observed: JevTurnRoutingReadout
  matches: {
    relation: boolean
    quality: boolean
    coverageExact: boolean
    action: boolean
    nextSignal: boolean
    fastClose: boolean
    risk: boolean
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() ?? ""
  const typeSafeApiKey = process.env.TYPESAFE_API_KEY?.trim() ?? ""
  const useOpenRouter = Boolean(openRouterApiKey)
  const apiKey = useOpenRouter ? openRouterApiKey : typeSafeApiKey
  const provider = useOpenRouter ? "openrouter" : "typesafe"
  const endpoint = useOpenRouter
    ? OPENROUTER_JEV_SHADOW_ENDPOINT
    : JEV_SHADOW_ENDPOINT
  const model =
    process.env.JEV_TURN_ROUTING_MODEL?.trim() ||
    (useOpenRouter ? OPENROUTER_JEV_SHADOW_MODEL : JEV_SHADOW_MODEL)

  if (dryRun) {
    const state = turnRoutingState(JEV_TURN_ROUTING_CASES[0], JEV_TURN_SIGNALS)
    process.stdout.write(`${JSON.stringify({
      mode: "dry-run",
      externalRequests: 0,
      databaseWrites: 0,
      applicantFacingChanges: 0,
      syntheticTurns: JEV_TURN_ROUTING_CASES.length,
      provider,
      model,
      endpoint,
      stateFields: Object.keys(state),
      questionIds: Object.keys(buildJevTurnRoutingQuestions(state)),
      reportContainsTurnText: false,
    }, null, 2)}\n`)
    return
  }

  if (!apiKey) {
    throw new Error("Neither OPENROUTER_API_KEY nor TYPESAFE_API_KEY is set")
  }

  const results: RoutingResult[] = []
  let coverageTruePositive = 0
  let coverageFalsePositive = 0
  let coverageFalseNegative = 0
  for (const calibrationCase of JEV_TURN_ROUTING_CASES) {
    const state = turnRoutingState(calibrationCase, JEV_TURN_SIGNALS)
    const evaluated = await evaluateJevTurnRouting({
      apiKey,
      endpoint,
      model,
      state,
    })
    const readout = interpretJevTurnRoutingResponse({
      response: evaluated.response,
      state,
    })
    const expectedCoverage = new Set(calibrationCase.expected.coveredSignalKeys)
    const observedCoverage = new Set(readout.coveredSignalKeys)
    for (const signal of JEV_TURN_SIGNALS) {
      const expected = expectedCoverage.has(signal.key)
      const observed = observedCoverage.has(signal.key)
      if (expected && observed) coverageTruePositive += 1
      else if (!expected && observed) coverageFalsePositive += 1
      else if (expected && !observed) coverageFalseNegative += 1
    }
    const coverageExact =
      expectedCoverage.size === observedCoverage.size &&
      [...expectedCoverage].every((key) => observedCoverage.has(key))
    results.push({
      caseId: calibrationCase.id,
      latencyMs: evaluated.latencyMs,
      model: evaluated.response.model,
      routedProvider: evaluated.response.provider ?? null,
      inputTokens: evaluated.response.usage.input_tokens,
      outputTokens: evaluated.response.usage.output_tokens,
      costUsd: evaluated.response.usage.cost ?? null,
      expected: calibrationCase.expected,
      observed: readout,
      matches: {
        relation: readout.relation === calibrationCase.expected.relation,
        quality: readout.quality === calibrationCase.expected.quality,
        coverageExact,
        action: readout.action === calibrationCase.expected.action,
        nextSignal: readout.nextSignalKey === calibrationCase.expected.nextSignalKey,
        fastClose: readout.fastClose === calibrationCase.expected.fastClose,
        risk: readout.risk === calibrationCase.expected.risk,
      },
    })
  }

  const countMatches = (key: keyof (typeof results)[number]["matches"]) =>
    results.filter((result) => result.matches[key]).length
  const precisionDenominator = coverageTruePositive + coverageFalsePositive
  const recallDenominator = coverageTruePositive + coverageFalseNegative
  const coveragePrecision = precisionDenominator
    ? coverageTruePositive / precisionDenominator
    : 1
  const coverageRecall = recallDenominator
    ? coverageTruePositive / recallDenominator
    : 1
  const coverageF1 = coveragePrecision + coverageRecall
    ? (2 * coveragePrecision * coverageRecall) / (coveragePrecision + coverageRecall)
    : 0
  const latencies = results.map((result) => result.latencyMs)
  const expectedMultiSignalCases = results.filter(
    (result) => result.expected.coveredSignalKeys.length > 1,
  )
  const expectedFastCloseCases = results.filter((result) => result.expected.fastClose)

  process.stdout.write(`${JSON.stringify({
    mode: "live-turn-routing-shadow",
    generatedAt: new Date().toISOString(),
    safety: {
      syntheticDataOnly: true,
      databaseWrites: 0,
      applicantFacingChanges: 0,
      accessDecisionsCreated: 0,
      reportContainsTurnText: false,
    },
    providerRequested: provider,
    modelRequested: model,
    endpoint,
    cases: results.length,
    exactAgreement: {
      relation: countMatches("relation") / results.length,
      quality: countMatches("quality") / results.length,
      coverage: countMatches("coverageExact") / results.length,
      action: countMatches("action") / results.length,
      nextSignal: countMatches("nextSignal") / results.length,
      fastClose: countMatches("fastClose") / results.length,
      risk: countMatches("risk") / results.length,
    },
    coverage: {
      truePositive: coverageTruePositive,
      falsePositive: coverageFalsePositive,
      falseNegative: coverageFalseNegative,
      precision: rounded(coveragePrecision, 4),
      recall: rounded(coverageRecall, 4),
      f1: rounded(coverageF1, 4),
      multiSignalCases: expectedMultiSignalCases.length,
      multiSignalExact: expectedMultiSignalCases.filter(
        (result) => result.matches.coverageExact,
      ).length,
    },
    terminalFastPath: {
      expected: expectedFastCloseCases.length,
      detected: expectedFastCloseCases.filter((result) => result.observed.fastClose).length,
      falsePositives: results.filter(
        (result) => !result.expected.fastClose && result.observed.fastClose,
      ).length,
    },
    latency: {
      meanMs: rounded(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      p50Ms: rounded(percentile(latencies, 0.5)),
      p95Ms: rounded(percentile(latencies, 0.95)),
      maxMs: rounded(Math.max(...latencies)),
    },
    totalCostUsd: results.every((result) => result.costUsd !== null)
      ? results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0)
      : null,
    results,
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
