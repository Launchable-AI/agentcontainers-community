/**
 * VM Terminal Service - SSH-based terminal sessions for VMs
 * Uses SSH to connect to VMs instead of docker exec
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';

interface VmTerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  vmId: string;
}

const sessions = new Map<string, VmTerminalSession>();

// Get SSH key path
function getSshKeyPath(dataDir: string): string {
  return path.join(dataDir, 'ssh-keys', 'id_ed25519');
}

export function createVmTerminalSession(
  ws: WebSocket,
  vmId: string,
  vmIp: string,
  dataDir: string,
  shell: string = '/bin/bash',
  cols: number = 80,
  rows: number = 24
): string {
  const sessionId = `vm-${vmId}-${Date.now()}`;
  const sshKeyPath = getSshKeyPath(dataDir);

  console.log(`[VM Terminal] Creating session: ${sessionId} for VM ${vmId} at ${vmIp}`);
  console.log(`[VM Terminal] SSH key path: ${sshKeyPath}`);
  console.log(`[VM Terminal] Data dir: ${dataDir}`);

  if (!fs.existsSync(sshKeyPath)) {
    console.error(`[VM Terminal] SSH key not found at ${sshKeyPath}`);
    ws.send(JSON.stringify({ type: 'error', message: `SSH key not found at ${sshKeyPath}` }));
    return '';
  }

  console.log(`[VM Terminal] SSH key exists, connecting to ${vmIp}...`);

  // Use SSH to connect to the VM
  // The -tt forces pseudo-terminal allocation
  const sshArgs = [
    '-tt',                                    // Force PTY allocation
    '-i', sshKeyPath,                         // SSH key
    '-o', 'StrictHostKeyChecking=no',         // Don't prompt for host key
    '-o', 'UserKnownHostsFile=/dev/null',     // Don't save host keys
    '-o', 'ConnectTimeout=10',                // Connection timeout
    '-o', 'ServerAliveInterval=30',           // Keep-alive
    '-o', 'ServerAliveCountMax=3',            // Keep-alive retries
    '-o', 'LogLevel=DEBUG',                   // Debug logging
    `agent@${vmIp}`,
    shell
  ];

  console.log(`[VM Terminal] SSH command: ssh ${sshArgs.join(' ')}`);

  const sshProcess = spawn('ssh', sshArgs, {
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    }
  });

  // Handle process output -> WebSocket
  sshProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[VM Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  // Handle process exit
  sshProcess.on('exit', (code) => {
    console.log(`[VM Terminal] Session ${sessionId} exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  sshProcess.on('error', (err) => {
    console.error(`[VM Terminal] Session ${sessionId} error:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { process: sshProcess, ws, vmId });

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  return sessionId;
}

export function writeToVmSession(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (session && session.process.stdin?.writable) {
    session.process.stdin.write(data);
    return true;
  }
  return false;
}

export function resizeVmSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (session && session.process.stdin?.writable) {
    // Send resize escape sequence for SSH PTY
    // Using stty command through the shell
    session.process.stdin.write(`\x15stty cols ${cols} rows ${rows} 2>/dev/null; clear\n`);
    console.log(`[VM Terminal] Resized session ${sessionId}: ${cols}x${rows}`);
    return true;
  }
  return false;
}

export function closeVmSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    if (!session.process.killed) {
      session.process.kill();
    }
    sessions.delete(sessionId);
    console.log(`[VM Terminal] Closed session ${sessionId}`);
  }
}

export function closeVmSessionByWebSocket(ws: WebSocket): void {
  for (const [id, session] of sessions.entries()) {
    if (session.ws === ws) {
      if (!session.process.killed) {
        session.process.kill();
      }
      sessions.delete(id);
      console.log(`[VM Terminal] Closed session ${id} due to WebSocket disconnect`);
      break;
    }
  }
}

export function getActiveVmSessionCount(): number {
  return sessions.size;
}
