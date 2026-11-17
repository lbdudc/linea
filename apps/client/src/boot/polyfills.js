import process from 'process'
import { Buffer } from 'buffer'
import EventEmitter from 'events'

const g = window

if (!g.global) {
  g.global = g
}

if (!g.process) {
  g.process = process
}

if (!g.Buffer) {
  g.Buffer = Buffer
}

if (!g.EventEmitter) {
  g.EventEmitter = EventEmitter
}
