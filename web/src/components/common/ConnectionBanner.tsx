import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useConnectionInfo, type ConnectionStatus } from '../../hooks/useConnectionStatus';

/**
 * ConnectionBanner — toast-based connection status indicator.
 * R9：新增 stale 状态（心跳超时但 WS 仍 open，说明弱网/延迟严重）
 */
export function ConnectionBanner() {
  const { status, staleFor } = useConnectionInfo();
  const prevStatus = useRef<ConnectionStatus>(status);
  const offlineToastId = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;

    if (status === 'offline' && prev !== 'offline') {
      if (offlineToastId.current) toast.dismiss(offlineToastId.current);
      offlineToastId.current = toast.error('网络已断开', { duration: Infinity });
    } else if (status === 'reconnecting' && prev !== 'reconnecting') {
      if (offlineToastId.current) toast.dismiss(offlineToastId.current);
      offlineToastId.current = toast.loading('连接中断，正在重连...', { duration: Infinity });
    } else if (status === 'stale' && prev !== 'stale') {
      // R9 新状态：心跳 stale（弱网 / 大延迟，WS 仍 open 但已 60s 未收到 pong）
      if (offlineToastId.current) toast.dismiss(offlineToastId.current);
      const seconds = Math.round(staleFor / 1000);
      offlineToastId.current = toast.warning(`连接延迟严重（已 ${seconds}s 未响应）`, { duration: Infinity });
    } else if (status === 'connected' && (prev === 'offline' || prev === 'reconnecting' || prev === 'stale')) {
      if (offlineToastId.current) {
        toast.dismiss(offlineToastId.current);
        offlineToastId.current = undefined;
      }
      toast.success('已恢复连接', { duration: 2000 });
    }

    return () => {
      if (offlineToastId.current) {
        toast.dismiss(offlineToastId.current);
        offlineToastId.current = undefined;
      }
    };
  }, [status, staleFor]);

  return null;
}
