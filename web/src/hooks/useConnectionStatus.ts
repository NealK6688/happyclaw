import { useState, useEffect } from 'react';
import { wsManager } from '../api/ws';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline' | 'stale';

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Round-trip time of last heartbeat ping (ms); -1 if unknown */
  rtt: number;
  /** Set when ws is connected but heartbeat is stale */
  staleFor: number;
}

/**
 * 兼容签名：返回 ConnectionStatus（向后兼容）
 * 新增 useConnectionInfo() 同时暴露 RTT / stale 信息
 */
export function useConnectionStatus(): ConnectionStatus {
  return useConnectionInfo().status;
}

export function useConnectionInfo(): ConnectionInfo {
  const [wsConnected, setWsConnected] = useState(wsManager.isConnected());
  const [online, setOnline] = useState(navigator.onLine);
  const [rtt, setRtt] = useState(-1);
  const [staleFor, setStaleFor] = useState(0);

  useEffect(() => {
    setWsConnected(wsManager.isConnected());
    const unsubConn = wsManager.on('connected', () => {
      setWsConnected(true);
      setStaleFor(0);
    });
    const unsubDisc = wsManager.on('disconnected', () => {
      setWsConnected(false);
    });
    // R9：心跳事件订阅 — 'heartbeat-alive' 更新 RTT，'heartbeat-stale' 标记 stale 状态
    const unsubAlive = wsManager.on('heartbeat-alive', (d: { rtt: number }) => {
      if (typeof d?.rtt === 'number') setRtt(d.rtt);
      setStaleFor(0);
    });
    const unsubStale = wsManager.on('heartbeat-stale', (d: { staleFor: number }) => {
      if (typeof d?.staleFor === 'number') setStaleFor(d.staleFor);
    });
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      unsubConn();
      unsubDisc();
      unsubAlive();
      unsubStale();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  let status: ConnectionStatus;
  if (!online) status = 'offline';
  else if (!wsConnected) status = 'reconnecting';
  else if (staleFor > 0) status = 'stale';
  else status = 'connected';

  return { status, rtt, staleFor };
}
