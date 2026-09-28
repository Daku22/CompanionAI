// kill-tree.mjs — chiude l'app avviata da uno script, figli compresi.
//
// Su Windows child.kill() chiude solo il processo principale di Electron: il
// processo GPU restava orfano, uno per ogni audit, smoke o anteprima.

import { execFileSync } from 'node:child_process'

/** @param {import('node:child_process').ChildProcess} child */
export function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch (_) { /* gia' uscito: resta child.kill() */ }
  }
  child.kill()
}
