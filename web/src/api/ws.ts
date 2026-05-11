import { replaceInApp, withBasePath } from '../utils/url';

type WsHandler = (data: any) => void;

class WsManager {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<WsHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  // R9：心跳。每 25s 发 ping，60s 未收 pong 则视为断线，主动 close 触发重连。
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private readonly HEARTBEAT_INTERVAL = 25_000;
  private readonly STALE_THRESHOLD = 60_000;

  connect() {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}${withBasePath('/ws')}`,
    );
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectDelay = 1000;
      this.lastPongAt = Date.now();
      this.startHeartbeat();
      this.emit('connected', {});
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          // R9：心跳响应。记录到达时间 + 派发 'heartbeat-alive' 供 UI 显示 RTT
          this.lastPongAt = Date.now();
          const rtt = typeof data.clientTimestamp === 'number' ? this.lastPongAt - data.clientTimestamp : -1;
          this.emit('heartbeat-alive', { rtt });
          return;
        }
        this.emit(data.type, data);
      } catch {}
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.emit('disconnected', {});
      // 1008 = Policy Violation (backend auth failure), 4001 = custom auth error
      if (event.code === 1008 || event.code === 4001) {
        this.ws = null;
        replaceInApp('/login');
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      ws.close();
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }
      // stale 检测：超过阈值未收 pong 视为断线，主动 close 触发 onclose → 重连
      const staleFor = Date.now() - this.lastPongAt;
      if (staleFor > this.STALE_THRESHOLD) {
        this.emit('heartbeat-stale', { staleFor });
        try { this.ws.close(4000, 'heartbeat-stale'); } catch {}
        return;
      }
      this.send({ type: 'ping', timestamp: Date.now() });
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  on(type: string, handler: WsHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, data: any) {
    this.handlers.get(type)?.forEach(h => h(data));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  /** Listen for network status changes to reconnect immediately or pause retries. */
  setupNetworkListeners() {
    window.addEventListener('online', () => {
      // Network restored — reconnect immediately, reset backoff
      if (!this.isConnected()) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.reconnectDelay = 1000;
        this.connect();
      }
    });
    window.addEventListener('offline', () => {
      // Network lost — cancel pending reconnect to avoid wasted attempts
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });
  }
}

export const wsManager = new WsManager();
wsManager.setupNetworkListeners();
