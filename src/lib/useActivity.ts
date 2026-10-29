import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialState, parseBackup, type ActivityState } from './model';

export const isDemo = new URLSearchParams(location.search).get('demo') === '1';
export const isSharedDemo = isDemo && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const storageKey = `redflower-panel-v1-${isDemo ? 'demo' : 'live'}`;
const channelKey = `${storageKey}-sync`;

export function useActivity(readOnly: boolean) {
  const [initial] = useState(() => {
    let raw = '';
    try {
      raw = localStorage.getItem(storageKey) || '';
      return { state: raw ? parseBackup(raw) : createInitialState(isDemo), error: '', raw: '' };
    } catch {
      return { state: createInitialState(isDemo), error: '无法读取原有本地记录。请先下载原记录，或恢复 JSON 备份。', raw };
    }
  });
  const [state, setState] = useState(initial.state);
  const ref = useRef(state);
  const channel = useRef<BroadcastChannel | null>(null);
  const [writeEnabled, setWriteEnabled] = useState<boolean>(!readOnly && (isSharedDemo || !navigator.locks));
  const [saveError, setSaveError] = useState(initial.error);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [screenConnected, setScreenConnected] = useState(false);
  const screenSeenAt = useRef(0);
  const corrupted = useRef(Boolean(initial.error));

  useEffect(() => {
    if (readOnly || isSharedDemo || !navigator.locks) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    navigator.locks.request(`${storageKey}-controller`, { ifAvailable: true }, async lock => {
      if (!lock || cancelled) return;
      setWriteEnabled(true);
      await new Promise<void>(resolve => { release = resolve; if (cancelled) resolve(); });
    }).catch(() => { if (!cancelled) setWriteEnabled(true); });
    return () => { cancelled = true; release?.(); setWriteEnabled(false); };
  }, [readOnly]);

  useEffect(() => {
    const accept = (next: ActivityState) => {
      if (next.revision >= ref.current.revision) { ref.current = next; setState(next); }
    };
    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      bc = new BroadcastChannel(channelKey);
      channel.current = bc;
      bc.onmessage = event => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'SCREEN_HELLO' && !readOnly) {
          screenSeenAt.current = Date.now(); setScreenConnected(true);
          bc?.postMessage({ type: 'STATE', state: ref.current });
        }
        if (message.type === 'STATE' && readOnly) {
          try { accept(parseBackup(JSON.stringify(message.state))); } catch { /* Ignore malformed peer data. */ }
        }
      };
      if (readOnly) bc.postMessage({ type: 'SCREEN_HELLO' });
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try { accept(parseBackup(event.newValue)); } catch { /* Keep the last good state. */ }
    };
    window.addEventListener('storage', onStorage);
    const heartbeat = window.setInterval(() => {
      if (readOnly) bc?.postMessage({ type: 'SCREEN_HELLO' });
      else setScreenConnected(Date.now() - screenSeenAt.current < 10_000);
    }, 3000);
    return () => { clearInterval(heartbeat); window.removeEventListener('storage', onStorage); bc?.close(); channel.current = null; };
  }, [readOnly]);

  const commit = useCallback((apply: (current: ActivityState) => ActivityState, recover = false) => {
    if (readOnly || !writeEnabled || (corrupted.current && !recover)) return false;
    let current = ref.current;
    // Public demo tabs may all be operated. Start each operation from the latest
    // saved revision so a recently opened tab cannot overwrite another tab's work.
    if (isSharedDemo) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const saved = parseBackup(raw);
          if (saved.revision > current.revision) current = saved;
        }
      } catch { /* Keep the current valid in-memory state if storage is unavailable. */ }
    }
    const next = apply(current);
    if (next === current) return false;
    next.revision = Math.max(current.revision + 1, next.revision);
    ref.current = next;
    setState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      corrupted.current = false; setSaveError(''); setSavedAt(Date.now());
    } catch {
      setSaveError('本地保存失败，请立即导出 JSON 备份；当前积分仍在本窗口。');
    }
    channel.current?.postMessage({ type: 'STATE', state: next });
    return true;
  }, [readOnly, writeEnabled]);

  return { state, commit, writeEnabled, saveError, savedAt, screenConnected, corruptedRaw: initial.raw, needsRecovery: corrupted.current };
}
