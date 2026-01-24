#!/usr/bin/env tsx
/**
 * Analyze benchmark results and output CSV summary
 * 
 * Reads all *.json files in tests/model/results/ and generates
 * a CSV with summary statistics for easy comparison.
 * 
 * Usage:
 *   npm run analyze
 *   # or
 *   tsx tests/model/analyze-results.ts
 */

import fs from 'fs/promises';
import path from 'path';

interface BenchResult {
  config: {
    name?: string;
    model: string;
    runs: number;
    system: string;
    user: string;
    validator?: string;
  };
  timestamp: string;
  summary: {
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    successRate: number;
    avgScore?: number;
    failures: string[];
  };
}

interface CSVRow {
  name: string;
  model: string;
  runs: number;
  timestamp: string;
  successRate: number;
  avgScore: number | null;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  failureCount: number;
}

async function loadResults(resultsDir: string): Promise<BenchResult[]> {
  const files = await fs.readdir(resultsDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'analysis.json');
  
  const results: BenchResult[] = [];
  
  for (const file of jsonFiles) {
    const filePath = path.join(resultsDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const result = JSON.parse(content) as BenchResult;
      results.push(result);
    } catch (err) {
      console.warn(`Skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  return results;
}

function resultToRow(result: BenchResult): CSVRow {
  return {
    name: result.config.name || 'unnamed',
    model: result.config.model,
    runs: result.config.runs,
    timestamp: result.timestamp,
    successRate: Math.round(result.summary.successRate * 100) / 100,
    avgScore: result.summary.avgScore !== undefined ? result.summary.avgScore : null,
    avgDurationMs: result.summary.avgDurationMs,
    minDurationMs: result.summary.minDurationMs,
    maxDurationMs: result.summary.maxDurationMs,
    failureCount: result.summary.failures.length,
  };
}

function rowToCSV(row: CSVRow): string {
  const scoreStr = row.avgScore !== null ? row.avgScore.toFixed(2) : '';
  return [
    row.name,
    row.model,
    row.runs,
    row.timestamp,
    row.successRate.toFixed(2),
    scoreStr,
    row.avgDurationMs,
    row.minDurationMs,
    row.maxDurationMs,
    row.failureCount,
  ].join(',');
}

async function main() {
  const resultsDir = path.join(process.cwd(), 'tests/model/results');
  
  console.log('Loading benchmark results...\n');
  const results = await loadResults(resultsDir);
  
  if (results.length === 0) {
    console.log('No result files found in tests/model/results/');
    return;
  }
  
  console.log(`Found ${results.length} result file(s)\n`);
  
  const rows = results.map(resultToRow);
  
  rows.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.timestamp.localeCompare(b.timestamp);
  });
  
  const headers = [
    'name',
    'model',
    'runs',
    'timestamp',
    'successRate',
    'avgScore',
    'avgDurationMs',
    'minDurationMs',
    'maxDurationMs',
    'failureCount',
  ];
  
  const csv = [
    headers.join(','),
    ...rows.map(rowToCSV),
  ].join('\n');
  
  const outputPath = path.join(resultsDir, 'analysis.csv');
  await fs.writeFile(outputPath, csv, 'utf-8');
  
  console.log('Summary Table:');
  console.log('='.repeat(100));
  console.log(
    'Name'.padEnd(25) +
    'Model'.padEnd(30) +
    'Score'.padEnd(8) +
    'Success'.padEnd(10) +
    'Avg(ms)'.padEnd(10)
  );
  console.log('-'.repeat(100));
  
  for (const row of rows) {
    const scoreStr = row.avgScore !== null ? row.avgScore.toFixed(2) : 'N/A';
    console.log(
      row.name.padEnd(25) +
      row.model.padEnd(30) +
      scoreStr.padEnd(8) +
      (row.successRate * 100).toFixed(0).padEnd(9) + '%' +
      row.avgDurationMs.toString().padEnd(10)
    );
  }
  
  console.log('='.repeat(100));
  console.log(`\n✓ Analysis saved to: ${outputPath}\n`);
  
  if (rows.some(r => r.avgScore !== null)) {
    console.log('Best Scores:');
    const scored = rows.filter(r => r.avgScore !== null).sort((a, b) => b.avgScore! - a.avgScore!);
    scored.slice(0, 5).forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.name} (${row.model}): ${row.avgScore!.toFixed(2)}`);
    });
    console.log();
  }
  
  console.log('Fastest Models:');
  const fastest = [...rows].sort((a, b) => a.avgDurationMs - b.avgDurationMs);
  fastest.slice(0, 5).forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.model}: ${row.avgDurationMs}ms (${row.name})`);
  });
  console.log();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
