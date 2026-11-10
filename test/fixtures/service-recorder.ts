import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const [events, restoration, service, serviceConfig, action] = process.argv.slice(2);
if (!events || !restoration || !service || !serviceConfig || !action || process.argv.length !== 7) throw new Error('Usage: service-recorder EVENTS RESTORATION SERVICE_JS SERVICE_CONFIG ACTION');
const record = existsSync(restoration) ? JSON.parse(readFileSync(restoration, 'utf8')) as { shutdown?: string } : undefined;
const pidfile = String(JSON.parse(readFileSync(serviceConfig, 'utf8')).pidfile);
const pid = existsSync(pidfile) ? Number(readFileSync(pidfile, 'utf8').trim()) : null;
const write = (entry: Record<string, unknown>) => appendFileSync(events, JSON.stringify({ ...entry, recorder: process.pid, at: Date.now() }) + '\n');
write({ phase: 'begin', action, recordPresent: record !== undefined, shutdown: record?.shutdown ?? null, pid });

const child = spawn(process.execPath, [service, serviceConfig, action], { stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); process.stdout.write(chunk); });
child.on('close', code => { write({ phase: 'end', action, code, stdout: stdout.trim() }); process.exitCode = code ?? 1; });
