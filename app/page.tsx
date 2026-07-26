"use client";

import { useCallback, useEffect, useState } from "react";

type Player = {
  name: string;
  accountName: string;
  level: number;
  ping: number;
};

type HistoricalPlayer = {
  name: string;
  accountName: string;
  level: number;
  hoursPlayed: number;
  firstSeen: number;
  lastSeen: number;
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

type HistoryData = {
  players: HistoricalPlayer[];
  trackingSince: string | null;
  collectedAt: string | null;
  sampleIntervalMinutes: number;
  warmingUp?: boolean;
};

const STATUS_REFRESH_INTERVAL = 15_000;
const HISTORY_REFRESH_INTERVAL = 60_000;

function formatUptime(totalSeconds = 0) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function formatHours(hours = 0) {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} h`;
}

function formatCheckedAt(value?: string | null) {
  if (!value) return "aguardando";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatTrackingDate(value?: string | null) {
  if (!value) return "iniciando agora";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
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

function ProgressChart({ players }: { players: HistoricalPlayer[] }) {
  const maxHours = Math.max(1, ...players.map((player) => player.hoursPlayed));
  const maxLevel = Math.max(1, ...players.map((player) => player.level));
  const levelTicks = [maxLevel, Math.round(maxLevel / 2), 0];
  const hourTicks = [0, maxHours / 2, maxHours];

  return (
    <div className="progress-chart">
      <div className="progress-chart__y-label">Nível</div>
      <div
        className="plot"
        role="img"
        aria-label="Gráfico de dispersão comparando nível e horas observadas de cada jogador"
      >
        <div className="plot__grid" aria-hidden="true" />
        {levelTicks.map((tick, index) => (
          <span
            className="plot__level-tick"
            key={`${tick}-${index}`}
            style={{ top: `${index * 50}%` }}
          >
            {tick}
          </span>
        ))}
        {players.map((player, index) => {
          const left = 8 + (player.hoursPlayed / maxHours) * 84;
          const bottom = 8 + (player.level / maxLevel) * 80;

          return (
            <span
              className="plot-point"
              key={`${player.name}-${player.accountName}`}
              style={
                {
                  left: `${left}%`,
                  bottom: `${bottom}%`,
                  "--point-index": index,
                } as React.CSSProperties
              }
              tabIndex={0}
              aria-label={`${player.name}: nível ${player.level}, ${formatHours(player.hoursPlayed)}`}
            >
              <span className="plot-point__core" aria-hidden="true" />
              <span className="plot-point__tooltip">
                <strong>{player.name}</strong>
                <span>Nível {player.level}</span>
                <span>{formatHours(player.hoursPlayed)}</span>
              </span>
            </span>
          );
        })}
      </div>
      <div className="progress-chart__x-axis" aria-hidden="true">
        {hourTicks.map((tick, index) => (
          <span key={`${tick}-${index}`}>{formatHours(tick)}</span>
        ))}
      </div>
      <div className="progress-chart__x-label">Horas observadas</div>
      <div className="chart-legend">
        {players.map((player, index) => (
          <span key={`${player.name}-${index}`}>
            <i style={{ "--point-index": index } as React.CSSProperties} />
            {player.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
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
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      setHistory((await response.json()) as HistoryData);
    } catch {
      setHistory({
        players: [],
        trackingSince: null,
        collectedAt: null,
        sampleIntervalMinutes: 5,
        warmingUp: true,
      });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadStatus(), loadHistory()]);
    setRefreshing(false);
  }, [loadHistory, loadStatus]);

  useEffect(() => {
    const initial = window.setTimeout(
      () => void Promise.all([loadStatus(), loadHistory()]),
      0,
    );
    const statusInterval = window.setInterval(
      () => void loadStatus(),
      STATUS_REFRESH_INTERVAL,
    );
    const historyInterval = window.setInterval(
      () => void loadHistory(),
      HISTORY_REFRESH_INTERVAL,
    );
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(statusInterval);
      window.clearInterval(historyInterval);
    };
  }, [loadHistory, loadStatus]);

  const online = data?.online ?? false;
  const metrics = data?.metrics;
  const players = data?.players ?? [];
  const historicalPlayers = history?.players ?? [];
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
            onClick={() => void refreshAll()}
            disabled={refreshing}
            aria-label="Atualizar todos os dados do servidor"
          >
            <span
              className={refreshing ? "refresh-icon is-spinning" : "refresh-icon"}
              aria-hidden="true"
            >
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
          detail={
            online
              ? `${metrics?.frameTime?.toFixed(1) ?? "0.0"} ms por frame`
              : "Sem dados"
          }
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

      <section className="history-panel" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">PROGRESSO OBSERVADO</span>
            <h2 id="history-title">Nível × horas de jogo</h2>
          </div>
          <span className="history-timestamp">
            Desde {formatTrackingDate(history?.trackingSince)}
          </span>
        </div>

        {historyLoading || historicalPlayers.length === 0 ? (
          <div className="empty-state history-empty" aria-live="polite">
            <span
              className={`empty-state__orb${historyLoading ? " is-loading" : ""}`}
              aria-hidden="true"
            />
            <strong>
              {historyLoading ? "Carregando histórico" : "Coleta histórica iniciada"}
            </strong>
            <p>
              O primeiro ponto aparece agora; as horas serão somadas a cada cinco
              minutos.
            </p>
          </div>
        ) : (
          <div className="history-grid">
            <article className="chart-card">
              <div className="card-heading">
                <div>
                  <strong>Progressão dos jogadores</strong>
                  <span>Cada ponto representa um jogador registrado</span>
                </div>
                <span className="sample-badge">
                  amostra / {history?.sampleIntervalMinutes ?? 5} min
                </span>
              </div>
              <ProgressChart players={historicalPlayers} />
            </article>

            <article className="rank-card">
              <div className="card-heading">
                <div>
                  <strong>Ranking de nível</strong>
                  <span>Desempate por horas observadas</span>
                </div>
              </div>
              <ol className="rank-list">
                {historicalPlayers.map((player, index) => (
                  <li key={`${player.name}-${player.accountName}`}>
                    <span className={`rank-position rank-position--${index + 1}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="rank-player">
                      <strong>{player.name}</strong>
                      <small>{formatHours(player.hoursPlayed)}</small>
                    </span>
                    <span className="rank-level">
                      <small>NÍVEL</small>
                      <strong>{player.level}</strong>
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          </div>
        )}
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
            <span
              className="empty-state__orb empty-state__orb--offline"
              aria-hidden="true"
            />
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
              <article
                className="player-row"
                key={`${player.name}-${player.accountName}`}
              >
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
                  <span
                    className={
                      player.ping < 80 ? "ping__dot" : "ping__dot ping__dot--warn"
                    }
                  />
                  <strong>{player.ping} ms</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>
          Status: 15 segundos · histórico: {history?.sampleIntervalMinutes ?? 5} minutos
        </span>
        <span>Monitor sem comandos administrativos</span>
      </footer>
    </main>
  );
}
