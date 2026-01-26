#!/usr/bin/env tsx
/**
 * LLM Benchmarking Tool
 * 
 * Tests prompt effectiveness by running identical prompts multiple times
 * and collecting statistics on response quality, parsing success, and timing.
 * 
 * Usage:
 *   npm run bench -- \
 *     --system tests/model/prompts/fastScan/system_01.md \
 *     --user tests/model/prompts/fastScan/user_01.md \
 *     --model local:qwen/qwen3-14b \
 *     --runs 20 \
 *     --name fast-scan-v1 \
 *     --validator tests/model/validators/fast-scan.ts
 */

import fs from "fs/promises";
import path from "path";
import { callLLMRaw } from "../../src/llm.js";

interface BenchConfig {
  system: string;       // Path to system prompt file
  user: string;         // Path to user prompt file
  model: string;        // provider:model spec
  runs: number;         // Number of test iterations
  name?: string;        // Output filename suffix
  validator?: string;   // Path to validator module
}

interface ValidationResult {
  success: boolean;
  parsed?: unknown;
  error?: string;
  score?: number;
  analysis?: Record<string, unknown>;
}

interface ValidatorModule {
  validate(response: string): ValidationResult | Promise<ValidationResult>;
}

interface RunResult {
  run: number;
  durationMs: number;
  response: string;
  finishReason: string | null;
  validation?: ValidationResult;
}

interface BenchResult {
  config: BenchConfig;
  timestamp: string;
  results: RunResult[];
  summary: {
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    successRate: number;
    failures: string[];
  };
}

async function loadValidator(validatorPath: string): Promise<ValidatorModule> {
  const absolutePath = path.resolve(validatorPath);
  const module = await import(absolutePath);
  
  if (!module.validate || typeof module.validate !== 'function') {
    throw new Error(`Validator module must export a 'validate' function: ${validatorPath}`);
  }
  
  return module as ValidatorModule;
}

async function runBenchmark(config: BenchConfig): Promise<BenchResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`LLM Benchmark: ${config.name || 'unnamed'}`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`Model:      ${config.model}`);
  console.log(`Runs:       ${config.runs}`);
  console.log(`System:     ${config.system}`);
  console.log(`User:       ${config.user}`);
  console.log(`Validator:  ${config.validator || 'none'}\n`);

  // Load prompts
  const systemPrompt = await fs.readFile(config.system, 'utf-8');
  const userPrompt = await fs.readFile(config.user, 'utf-8');

  // Load validator if provided
  let validator: ValidatorModule | null = null;
  if (config.validator) {
    validator = await loadValidator(config.validator);
    console.log(`✓ Validator loaded\n`);
  }

  const results: RunResult[] = [];
  const failures: string[] = [];

  // Run tests
  for (let i = 1; i <= config.runs; i++) {
    process.stdout.write(`Run ${i}/${config.runs}... `);

    const startTime = Date.now();
    let response: string | null = null;
    let finishReason: string | null = null;
    let error: string | undefined;

    try {
      const rawResult = await callLLMRaw(systemPrompt, userPrompt, {
        model: config.model,
        temperature: 0.7,
      });
      
      response = rawResult.content || '';
      finishReason = rawResult.finishReason;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      failures.push(`run ${i}: ${error}`);
    }

    const durationMs = Date.now() - startTime;

    let validation: ValidationResult | undefined;
    if (validator && response) {
      validation = await validator.validate(response);
      if (!validation.success) {
        failures.push(`run ${i}: ${validation.error || 'validation failed'}`);
      }
    }

    results.push({
      run: i,
      durationMs,
      response: response || '',
      finishReason,
      validation,
    });

    // Status output
    if (error) {
      console.log(`❌ ERROR: ${error}`);
    } else if (validation) {
      const scoreStr = validation.score !== undefined ? ` (score: ${validation.score})` : '';
      console.log(validation.success ? `✓ ${durationMs}ms${scoreStr}` : `✗ ${durationMs}ms`);
    } else {
      console.log(`✓ ${durationMs}ms`);
    }
  }

  // Calculate summary
  const durations = results.map(r => r.durationMs);
  const avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minDurationMs = Math.min(...durations);
  const maxDurationMs = Math.max(...durations);
  
  const successCount = validator
    ? results.filter(r => r.validation?.success).length
    : results.filter(r => r.response).length;
  const successRate = successCount / config.runs;

  const scores = results.filter(r => r.validation?.score !== undefined).map(r => r.validation!.score!);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
  
  const summary = {
    avgDurationMs: Math.round(avgDurationMs),
    minDurationMs,
    maxDurationMs,
    successRate,
    avgScore: avgScore !== undefined ? Math.round(avgScore * 100) / 100 : undefined,
    failures,
  };

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`Success rate:   ${(successRate * 100).toFixed(1)}% (${successCount}/${config.runs})`);
  console.log(`Avg duration:   ${summary.avgDurationMs}ms`);
  console.log(`Min duration:   ${summary.minDurationMs}ms`);
  console.log(`Max duration:   ${summary.maxDurationMs}ms`);
  
  if (summary.avgScore !== undefined) {
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    console.log(`\nQuality Scores:`);
    console.log(`  Avg: ${summary.avgScore.toFixed(2)}`);
    console.log(`  Min: ${minScore.toFixed(2)}`);
    console.log(`  Max: ${maxScore.toFixed(2)}`);
  }
  
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }

  return {
    config,
    timestamp: new Date().toISOString(),
    results,
    summary,
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse args
  const config: Partial<BenchConfig> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    
    switch (arg) {
      case '--system':
        config.system = next;
        i++;
        break;
      case '--user':
        config.user = next;
        i++;
        break;
      case '--model':
        config.model = next;
        i++;
        break;
      case '--runs':
        config.runs = parseInt(next, 10);
        i++;
        break;
      case '--name':
        config.name = next;
        i++;
        break;
      case '--validator':
        config.validator = next;
        i++;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  // Validate required args
  if (!config.system || !config.user || !config.model || !config.runs) {
    console.error(`
Usage: npm run bench -- \\
  --system <path> \\
  --user <path> \\
  --model <provider:model> \\
  --runs <number> \\
  [--name <string>] \\
  [--validator <path>]

Example:
  npm run bench -- \\
    --system tests/model/prompts/fastScan/system_01.md \\
    --user tests/model/prompts/fastScan/user_01.md \\
    --model local:qwen/qwen3-14b \\
    --runs 20 \\
    --name fast-scan-baseline \\
    --validator tests/model/validators/fast-scan.ts
`);
    process.exit(1);
  }

  const benchConfig = config as BenchConfig;
  
  // Run benchmark
  const result = await runBenchmark(benchConfig);

  // Save results
  const resultsDir = path.join(process.cwd(), 'tests/model/results');
  await fs.mkdir(resultsDir, { recursive: true });
  
  const justModel = /.*[:\/](.*)/.exec(benchConfig.model)[1];
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const filename = benchConfig.name
    ? `${benchConfig.name}_${justModel}_${timestamp}.json`
    : `${justModel}_bench_${timestamp}.json`;
  
  const outputPath = path.join(resultsDir, filename);
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  
  console.log(`\n✓ Results saved to: ${outputPath}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
