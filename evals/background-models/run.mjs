import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// Reuse ESLint's installed validator; fail explicitly if that dependency changes.
const require = createRequire(import.meta.url)
const Ajv = createRequire(require.resolve('eslint'))('ajv')
const ajv = new Ajv({ allErrors: true })
const root = fileURLToPath(new URL('./artifacts/', import.meta.url))
const requests = JSON.parse(readFileSync(`${root}requests.json`, 'utf8'))
const models = ['anthropic/claude-haiku-4.5', 'mistralai/mistral-small-3.2-24b-instruct', 'qwen/qwen3-235b-a22b-2507']
const repeats = 2
const live = process.argv.includes('--live')
const provider = { require_parameters: true, data_collection: 'deny', max_price: { prompt: 2, completion: 6 } }
// Conservative byte-based input allowance plus framing; provider price ceilings are per million tokens.
const reservedUsd = requests.reduce((sum, row) => sum + ((Buffer.byteLength(JSON.stringify(row.request)) + 1024) * 2 + row.request.max_tokens * 6) / 1e6, 0) * models.length * repeats
if (reservedUsd > 2) throw new Error('Preflight upper estimate exceeds $2; reduce fixture count')
console.log(JSON.stringify({ live, calls: requests.length * models.length * repeats, reservedUsd, models }))
if (!live) process.exit(0)
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required')
const catalogResponse = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30000) })
if (!catalogResponse.ok) throw new Error(`Model catalogue HTTP ${catalogResponse.status}`)
const catalog = await catalogResponse.json()
const selected = models.map(id => {
  const model = catalog.data.find(entry => entry.id === id)
  if (!model?.supported_parameters.includes('structured_outputs')) throw new Error(`Structured outputs unavailable: ${id}`)
  return model
})
const runId = new Date().toISOString().replaceAll(':', '-')
const dir = `${root}${runId}`
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/manifest.json`, JSON.stringify({ runId, provider, repeats, reservedUsd, selected,
  transport: 'All models through OpenRouter; not production direct-Anthropic pricing or an EU-hosting compliance test.',
  datasetSha256: createHash('sha256').update(JSON.stringify(requests)).digest('hex'),
  requests,
}, null, 2))
const results = []
async function run(row, model, repeat) {
  const started = performance.now()
  const result = { fixture: row.fixture, task: row.task, model, repeat, requestSha256: row.sha256 }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider, temperature: 0, max_tokens: row.request.max_tokens,
        messages: [{ role: 'system', content: row.request.system }, ...row.request.messages],
        response_format: { type: 'json_schema', json_schema: { name: `${row.task}_extraction`, strict: true, schema: row.request.output_config.format.schema } },
      }),
    })
    result.httpStatus = response.status
    const body = await response.json()
    result.responseId = body.id
    result.provider = body.provider
    result.actualModel = body.model
    result.usage = body.usage ?? null
    result.costUsd = typeof body.usage?.cost === 'number' ? body.usage.cost : null
    result.finishReason = body.choices?.[0]?.finish_reason
    if (!response.ok || body.error) throw new Error(JSON.stringify(body.error ?? { status: response.status }))
    result.raw = body.choices?.[0]?.message?.content ?? ''
    result.output = JSON.parse(result.raw)
    const validate = ajv.compile(row.request.output_config.format.schema)
    result.schemaValid = validate(result.output)
    result.schemaErrors = validate.errors
    result.complete = result.finishReason === 'stop'
    if (row.task === 'cultural' && result.schemaValid) {
      const signals = result.output.signals
      result.constraintsValid = signals.every(signal => signal.displayLabel.trim().split(/\s+/).length <= 8)
        && [...new Set(signals.map(signal => signal.sourceMessageId))].every(id => signals.filter(signal => signal.sourceMessageId === id).length <= 4)
    } else if (row.task === 'profile' && result.schemaValid) {
      const core = result.output.core
      result.constraintsValid = core.summary.length <= 280 && core.intent_tags.length <= 5 && core.interests.length <= 10 && core.confidence >= 0 && core.confidence <= 1
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  result.ms = Math.round(performance.now() - started)
  results.push(result)
  appendFileSync(`${dir}/results.jsonl`, JSON.stringify(result) + '\n')
  console.log(`${results.length}/${requests.length * models.length * repeats} ${model} ${row.task}/${row.fixture} ${result.error ? 'ERROR' : result.schemaValid && result.complete && result.constraintsValid ? 'valid' : 'INVALID'} ${result.ms}ms`)
}
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const row of requests) {
    // Same fixture in a bounded batch; rotate dispatch order between repeats.
    await Promise.all(models.map((_, index) => run(row, models[(index + repeat) % models.length], repeat)))
  }
}
const summary = models.flatMap(model => ['profile', 'cultural'].map(task => {
  const rows = results.filter(row => row.model === model && row.task === task)
  const valid = rows.filter(row => !row.error && row.schemaValid && row.complete && row.constraintsValid)
  const costsKnown = rows.every(row => row.costUsd !== null && row.costUsd !== undefined)
  const costUsd = costsKnown ? rows.reduce((sum, row) => sum + row.costUsd, 0) : null
  const times = rows.map(row => row.ms).sort((a,b) => a-b)
  return { model, task, attempts: rows.length, structurallyValid: valid.length, costsKnown, costUsd,
    usdPer1000Attempts: costUsd === null ? null : costUsd / rows.length * 1000,
    medianMs: (times[Math.floor((times.length-1)/2)] + times[Math.floor(times.length/2)]) / 2,
    note: 'Structural validity is not semantic quality. Review every output against the supplied transcript and rubric.' }
}))
writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ dir, summary }, null, 2))
