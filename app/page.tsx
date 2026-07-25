"use client";

import { useCallback, useEffect, useState } from "react";

type Player = {
  name: string;
  accountName: string;
  level: number;
  ping: number;
};

type DashboardData = {
  online: boolean;
  checkedAt: string;
  info?: {
    version: string;
    serverName: string;
    description: string;
  };
  metrics?: {
    currentPlayers: number;
    maxPlayers: number;
    serverFps: number;
    averageFps: number;
    frameTime: number;
    worldDays: number;
    baseCamps: number;
    uptimeSeconds: number;
  };
  players?: Player[];
  error?: string;
};

const REFRESH_INTERVAL = 15_000;

function formatUptime(totalSeconds = 0) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function formatCheckedAt(value?: string) {
  if (!value) return "aguardando";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function StatCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={`stat-card${accent ? " stat-card--accent" : ""}`}>
      <span className="stat-card__label">{label}</span>
      <strong className="stat-card__value">{value}</strong>
      <span className="stat-card__detail">{detail}</span>
    </article>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);

    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const payload = (await response.json()) as DashboardData;
      setData(payload);
    } catch {
      setData({
        online: false,
        checkedAt: new Date().toISOString(),
        error: "Não foi possível alcançar o monitor do servidor.",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadStatus(), 0);
    const interval = window.setInterval(() => void loadStatus(), REFRESH_INTERVAL);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadStatus]);

  const online = data?.online ?? false;
  const metrics = data?.metrics;
  const players = data?.players ?? [];
  const occupancy = metrics?.maxPlayers
    ? Math.min(100, (metrics.currentPlayers / metrics.maxPlayers) * 100)
    : 0;

  return (
    <main className="dashboard-shell">
      <div className="ambient-grid" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Manapal — início">
          <span className="brand__mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>MANAPAL</strong>
            <small>SERVER MONITOR</small>
          </span>
        </a>

        <div className="topbar__actions">
          <span className="readonly-badge">
            <span aria-hidden="true">◉</span> Somente leitura
          </span>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void loadStatus(true)}
            disabled={refreshing}
            aria-label="Atualizar dados do servidor"
          >
            <span className={refreshing ? "refresh-icon is-spinning" : "refresh-icon"} aria-hidden="true">
              ↻
            </span>
            {refreshing ? "Atualizando" : "Atualizar"}
          </button>
        </div>
      </header>

      <section className="hero" id="overview">
        <div className="hero__copy">
          <div className="eyebrow">PALWORLD · SOUTH AMERICA</div>
          <div className="hero__title-row">
            <h1>{data?.info?.serverName || "Manapal"}</h1>
            <div
              className={`status-pill ${online ? "status-pill--online" : "status-pill--offline"}`}
              role="status"
              aria-live="polite"
            >
              <span className="status-dot" aria-hidden="true" />
              {loading ? "Verificando" : online ? "Online" : "Offline"}
            </div>
          </div>
          <p>
            {data?.info?.description ||
              "Telemetria ao vivo do servidor dedicado de Palworld."}
          </p>
          <div className="hero__meta">
            <span>Versão {data?.info?.version || "—"}</span>
            <span className="meta-separator" aria-hidden="true" />
            <span>Atualizado às {formatCheckedAt(data?.checkedAt)}</span>
          </div>
        </div>

        <article className="population-card" aria-label="Ocupação do servidor">
          <div className="population-card__head">
            <span>Jogadores online</span>
            <span>{Math.round(occupancy)}% ocupado</span>
          </div>
          <div className="population-card__count">
            <strong>{loading ? "—" : metrics?.currentPlayers ?? 0}</strong>
            <span>/ {metrics?.maxPlayers ?? 32}</span>
          </div>
          <div
            className="occupancy-track"
            role="progressbar"
            aria-label="Ocupação do servidor"
            aria-valuemin={0}
            aria-valuemax={metrics?.maxPlayers ?? 32}
            aria-valuenow={metrics?.currentPlayers ?? 0}
          >
            <span style={{ width: `${occupancy}%` }} />
          </div>
          <span className="population-card__foot">
            {online ? "Aceitando conexões" : data?.error || "Servidor indisponível"}
          </span>
        </article>
      </section>

      <section className="stats-grid" aria-label="Métricas do servidor">
        <StatCard
          label="Desempenho"
          value={online ? `${metrics?.serverFps ?? 0} FPS` : "—"}
          detail={online ? `${metrics?.frameTime?.toFixed(1) ?? "0.0"} ms por frame` : "Sem dados"}
          accent
        />
        <StatCard
          label="Tempo ligado"
          value={online ? formatUptime(metrics?.uptimeSeconds) : "—"}
          detail="Desde o último reinício"
        />
        <StatCard
          label="Dias no mundo"
          value={online ? `${metrics?.worldDays ?? 0}` : "—"}
          detail="Ciclo atual do servidor"
        />
        <StatCard
          label="Bases ativas"
          value={online ? `${metrics?.baseCamps ?? 0}` : "—"}
          detail="Acampamentos registrados"
        />
      </section>

      <section className="players-panel" aria-labelledby="players-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">PRESENÇA AO VIVO</span>
            <h2 id="players-title">Jogadores conectados</h2>
          </div>
          <span className="player-total">{players.length} online</span>
        </div>

        {loading ? (
          <div className="empty-state" aria-live="polite">
            <span className="empty-state__orb is-loading" aria-hidden="true" />
            <strong>Sincronizando com o servidor</strong>
            <p>Buscando a telemetria mais recente.</p>
          </div>
        ) : !online ? (
          <div className="empty-state" aria-live="polite">
            <span className="empty-state__orb empty-state__orb--offline" aria-hidden="true" />
            <strong>Servidor fora do alcance</strong>
            <p>{data?.error || "A próxima tentativa acontece automaticamente."}</p>
          </div>
        ) : players.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__orb" aria-hidden="true" />
            <strong>Nenhum aventureiro por aqui</strong>
            <p>O servidor está online e pronto para receber jogadores.</p>
          </div>
        ) : (
          <div className="player-list">
            <div className="player-list__header" aria-hidden="true">
              <span>Jogador</span>
              <span>Plataforma</span>
              <span>Nível</span>
              <span>Latência</span>
            </div>
            {players.map((player) => (
              <article className="player-row" key={`${player.name}-${player.accountName}`}>
                <div className="player-identity">
                  <span className="player-avatar" aria-hidden="true">
                    {player.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{player.name}</strong>
                    <small>{player.accountName || "Conta Palworld"}</small>
                  </div>
                </div>
                <span className="platform-tag">Crossplay</span>
                <div className="mobile-stat">
                  <small>Nível</small>
                  <strong>{player.level}</strong>
                </div>
                <div className="ping">
                  <small>Latência</small>
                  <span className={player.ping < 80 ? "ping__dot" : "ping__dot ping__dot--warn"} />
                  <strong>{player.ping} ms</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>Dados atualizados automaticamente a cada 15 segundos</span>
        <span>Monitor sem comandos administrativos</span>
      </footer>
    </main>
  );
}
