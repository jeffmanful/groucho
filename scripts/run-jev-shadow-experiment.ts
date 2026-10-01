import { JEV_SHADOW_CASES } from "@/evals/jev-shadow-cases"
import {
  buildJevShadowRequest,
  evaluateJevShadow,
  interpretJevShadowResponse,
  JEV_SHADOW_MODEL,
  JEV_SHADOW_ENDPOINT,
  OPENROUTER_JEV_SHADOW_ENDPOINT,
  OPENROUTER_JEV_SHADOW_MODEL,
  primaryJevShadowRisk,
} from "@/lib/jev-shadow-evaluation"

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10
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
  const defaultModel = useOpenRouter
    ? OPENROUTER_JEV_SHADOW_MODEL
    : JEV_SHADOW_MODEL
  const model = process.env.JEV_SHADOW_MODEL?.trim() || defaultModel

  if (dryRun) {
    const sampleCase = JEV_SHADOW_CASES[0]
    const sampleRequest = buildJevShadowRequest({
      applicantEvidence: sampleCase.applicantEvidence,
      neutralMissingInformation: sampleCase.neutralMissingInformation,
    }, model)
    process.stdout.write(`${JSON.stringify({
      mode: "dry-run",
      externalRequests: 0,
      databaseWrites: 0,
      applicantFacingChanges: 0,
      syntheticCases: JEV_SHADOW_CASES.length,
      provider,
      model,
      endpoint,
      questionIds: Object.keys(sampleRequest.questions),
      outboundStateFields: Object.keys(sampleRequest.state),
      reportContainsEvidenceText: false,
    }, null, 2)}\n`)
    return
  }

  if (!apiKey) {
    throw new Error(
      "Neither OPENROUTER_API_KEY nor TYPESAFE_API_KEY is set. Add one to .env.local or the command environment, then rerun pnpm experiment:jev-shadow.",
    )
  }

  const results = []
  for (const calibrationCase of JEV_SHADOW_CASES) {
    const evaluated = await evaluateJevShadow({
      apiKey,
      endpoint,
      model,
      state: {
        applicantEvidence: calibrationCase.applicantEvidence,
        neutralMissingInformation: calibrationCase.neutralMissingInformation,
      },
    })
    const readout = interpretJevShadowResponse(evaluated.response)
    const observedRisk = primaryJevShadowRisk(readout)
    results.push({
      caseId: calibrationCase.id,
      expectedRecommendation: calibrationCase.expectedRecommendation,
      observedRecommendation: readout.recommendation,
      recommendationMatch:
        readout.recommendation === calibrationCase.expectedRecommendation,
      expectedOrientation: calibrationCase.expectedOrientation,
      observedOrientation: readout.orientation,
      orientationMatch: readout.orientation === calibrationCase.expectedOrientation,
      expectedRisk: calibrationCase.expectedRisk,
      observedRisk,
      riskMatch: observedRisk === calibrationCase.expectedRisk,
      latencyMs: evaluated.latencyMs,
      model: evaluated.response.model,
      inputTokens: evaluated.response.usage.input_tokens,
      outputTokens: evaluated.response.usage.output_tokens,
      costUsd: evaluated.response.usage.cost ?? null,
      routedProvider: evaluated.response.provider ?? null,
      composite: readout.composite,
      dimensions: readout.dimensions,
      sufficiency: readout.sufficiency,
      sufficiencyConfidence: readout.sufficiencyConfidence,
      risks: readout.risks,
    })
  }

  const latencies = results.map((result) => result.latencyMs)
  const recommendationMatches = results.filter((result) => result.recommendationMatch).length
  const orientationMatches = results.filter((result) => result.orientationMatch).length
  const riskMatches = results.filter((result) => result.riskMatch).length
  process.stdout.write(`${JSON.stringify({
    mode: "live-shadow",
    generatedAt: new Date().toISOString(),
    safety: {
      syntheticDataOnly: true,
      databaseWrites: 0,
      applicantFacingChanges: 0,
      accessDecisionsCreated: 0,
      reportContainsEvidenceText: false,
    },
    modelRequested: model,
    providerRequested: provider,
    endpoint,
    cases: results.length,
    recommendationAgreement: recommendationMatches / results.length,
    orientationAgreement: orientationMatches / results.length,
    riskAgreement: riskMatches / results.length,
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
