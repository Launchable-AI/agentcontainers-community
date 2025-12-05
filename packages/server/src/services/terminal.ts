/**
 * Terminal Service - WebSocket-based terminal sessions
 * Uses docker exec with 'script' command for PTY emulation (no native modules needed)
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';

interface TerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  containerId: string;
}

const sessions = new Map<string, TerminalSession>();

export function createTerminalSession(
  ws: WebSocket,
  containerId: string,
  shell: string = '/bin/bash',
  cols: number = 80,
  rows: number = 24
): string {
  const sessionId = `${containerId}-${Date.now()}`;

  console.log(`🔧 Creating terminal session: ${sessionId}`);

  // Use docker exec with 'script' to create a pseudo-TTY
  // This avoids needing node-pty native module
  const process = spawn('docker', [
    'exec',
    '-i',                        // Interactive mode
    '-e', 'TERM=xterm-256color', // Set terminal type
    '-e', `COLUMNS=${cols}`,     // Terminal width
    '-e', `LINES=${rows}`,       // Terminal height
    containerId,
    'script',                    // Use script for PTY emulation
    '-qec',                      // Quiet, execute command
    shell,
    '/dev/null',                 // Output to /dev/null (we capture via stdout)
  ]);

  // Handle process output → WebSocket
  process.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      // Convert LF to CRLF for proper terminal display
      const output = data.toString().replace(/\n/g, '\r\n');
      ws.send(JSON.stringify({ type: 'output', data: output }));
    }
  });

  process.stderr?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      const output = data.toString().replace(/\n/g, '\r\n');
      ws.send(JSON.stringify({ type: 'output', data: output }));
    }
  });

  // Handle process exit
  process.on('exit', (code) => {
    console.log(`   Shell exited with code ${code} for session ${sessionId}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  process.on('error', (err) => {
    console.error(`   Process error for session ${sessionId}:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { process, ws, containerId });

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  return sessionId;
}

export function writeToSession(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (session && session.process.stdin?.writable) {
    // Convert CR to LF for bash (xterm sends CR on Enter)
    let input = data;
    if (input === '\r') {
      input = '\n';
    }
    session.process.stdin.write(input);
    return true;
  }
  return false;
}

export function resizeSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (session) {
    // Note: Without node-pty, we can't dynamically resize
    // The terminal will use the initial size set at creation
    // This is a limitation of this approach, but acceptable for most use cases
    console.log(`   Resize requested for ${sessionId}: ${cols}x${rows} (not supported without PTY)`);
    return true;
  }
  return false;
}

export function closeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    if (!session.process.killed) {
      session.process.kill();
    }
    sessions.delete(sessionId);
  }
}

export function closeSessionByWebSocket(ws: WebSocket): void {
  for (const [id, session] of sessions.entries()) {
    if (session.ws === ws) {
      if (!session.process.killed) {
        session.process.kill();
      }
      sessions.delete(id);
      console.log(`   Closed session ${id} due to WebSocket disconnect`);
      break;
    }
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}
