#!/usr/bin/env node
import { runCi } from './cli.mjs'

process.exitCode = await runCi({
  argv: process.argv.slice(2),
  io: { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) }
})
