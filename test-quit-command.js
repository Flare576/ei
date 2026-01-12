#!/usr/bin/env node

// Simple test to check if /quit command works
import { spawn } from 'child_process';

console.log('Testing /quit command...');

const child = spawn('npm', ['start'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
  console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString());
});

// Wait for app to start, then send quit command
setTimeout(() => {
  console.log('Sending /quit command...');
  child.stdin.write('/quit\n');
}, 3000);

child.on('close', (code) => {
  console.log(`Process exited with code: ${code}`);
  console.log('Total output length:', output.length);
  process.exit(0);
});

// Kill after 10 seconds if it doesn't exit
setTimeout(() => {
  console.log('Timeout - killing process');
  child.kill('SIGTERM');
  process.exit(1);
}, 10000);