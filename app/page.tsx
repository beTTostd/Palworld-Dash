"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Player = {
  name: string;
  accountName: string;
  level: number;
  ping: number;
};

type HistoricalPlayer = {
  playerKey: string;
  name: string;
  accountName: string;
  level: number;
  hoursPlayed: number;
  firstSeen: number;
  lastSeen: number;
};

type HistoricalPoint = {
  playerKey: string;
  name: string;
  accountName: string;
  sampledAt: number;
  level: number;
  hoursPlayed: number;
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
  progress: HistoricalPoint[];
  trackingSince: string | null;
  collectedAt: string | null;
  sampleIntervalMinutes: number;
  events?: Array<{ occurredAt: number; playerKey: string; name: string; type: string; level: number; previousLevel?: number | null }>;
  collector?: { lastSampleAt?: number | null; durationMs?: number | null; stale?: boolean };
  warmingUp?: boolean;
};

const STATUS_REFRESH_INTERVAL = 15_000;
const HISTORY_REFRESH_INTERVAL = 60_000;
const MIN_OBSERVED_HOURS = 5 / 60;

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

function formatEvent(type: string, level: number, previousLevel?: number | null) {
  if (type === "level_up") return `subiu do nível ${previousLevel ?? Math.max(0, level - 1)} para ${level}`;
  return type === "joined" ? `entrou no servidor · nível ${level}` : `saiu do servidor · nível ${level}`;
}

function formatSampleDate(timestamp = 0) {
  if (!timestamp) return "aguardando";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1_000));
}

function removeIsolatedOutliers(points: HistoricalPoint[]) {
  if (points.length < 3) return points;

  return points.filter((point, index, allPoints) => {
    if (index === 0) {
      const nextBaseline = Math.min(allPoints[1].level, allPoints[2].level);
      return nextBaseline - point.level < 5;
    }
    if (index === allPoints.length - 1) return true;

    const previousLevel = allPoints[index - 1].level;
    const nextLevel = allPoints[index + 1].level;
    const lowerNeighbor = Math.min(previousLevel, nextLevel);
    const upperNeighbor = Math.max(previousLevel, nextLevel);

    return point.level >= lowerNeighbor && point.level <= upperNeighbor;
  });
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

function ProgressChart({
  players,
  points,
}: {
  players: HistoricalPlayer[];
  points: HistoricalPoint[];
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    point: HistoricalPoint;
    playerName: string;
    playerIndex: number;
    left: number;
    bottom: number;
  } | null>(null);
  const series = useMemo(() => {
    const keyFor = (name: string, accountName: string) =>
      `${name}\u0000${accountName}`;
    const grouped = new Map<string, HistoricalPoint[]>();

    for (const point of points) {
      const key = keyFor(point.name, point.accountName);
      const playerPoints = grouped.get(key) ?? [];
      playerPoints.push(point);
      grouped.set(key, playerPoints);
    }

    const playerKeys = players.map((player) =>
      keyFor(player.name, player.accountName),
    );
    const extraKeys = [...grouped.keys()].filter(
      (key) => !playerKeys.includes(key),
    );

    return [...playerKeys, ...extraKeys].map((key, index) => {
      const player = players.find(
        (candidate) => keyFor(candidate.name, candidate.accountName) === key,
      );
      const recorded = [...(grouped.get(key) ?? [])].sort(
        (a, b) => a.sampledAt - b.sampledAt,
      );
      const fallback = player
        ? [
            {
              playerKey: player.playerKey,
              name: player.name,
              accountName: player.accountName,
              sampledAt: player.lastSeen,
              level: player.level,
              hoursPlayed: player.hoursPlayed,
            },
          ]
        : [];
      const cleanedPoints =
        recorded.length > 0 ? removeIsolatedOutliers(recorded) : fallback;
      const initialHours = cleanedPoints[0]?.hoursPlayed ?? 0;
      const seriesPoints = cleanedPoints.map((point) => ({
        ...point,
        hoursPlayed:
          MIN_OBSERVED_HOURS + Math.max(0, point.hoursPlayed - initialHours),
      }));

      return {
        key,
        index,
        name: player?.name ?? seriesPoints[0]?.name ?? "Jogador",
        points: seriesPoints,
        levelUps: seriesPoints.filter(
          (point, pointIndex, allPoints) =>
            pointIndex > 0 && point.level > allPoints[pointIndex - 1].level,
        ),
      };
    });
  }, [players, points]);
  const allPoints = series.flatMap((playerSeries) => playerSeries.points);
  const maxHours = Math.max(
    MIN_OBSERVED_HOURS,
    ...allPoints.map((point) => point.hoursPlayed),
  );
  const logHourRange = Math.log(maxHours / MIN_OBSERVED_HOURS);
  const levels =
    allPoints.length > 0
      ? allPoints.map((point) => point.level)
      : players.map((player) => player.level);
  const observedMinLevel = Math.min(...levels);
  const observedMaxLevel = Math.max(...levels);
  const levelPadding =
    observedMaxLevel === observedMinLevel
      ? 1
      : Math.max(1, Math.ceil((observedMaxLevel - observedMinLevel) * 0.12));
  const minLevel = Math.max(0, observedMinLevel - levelPadding);
  const maxLevel = Math.max(minLevel + 1, observedMaxLevel + levelPadding);
  const levelRange = maxLevel - minLevel;
  const levelTicks = [
    maxLevel,
    Math.round((maxLevel + minLevel) / 2),
    minLevel,
  ];
  const hourTicks =
    maxHours === MIN_OBSERVED_HOURS
      ? [MIN_OBSERVED_HOURS]
      : [MIN_OBSERVED_HOURS, Math.sqrt(MIN_OBSERVED_HOURS * maxHours), maxHours];
  const positionFor = useCallback(
    (point: HistoricalPoint) => {
      const observedHours = Math.max(point.hoursPlayed, MIN_OBSERVED_HOURS);
      const hourPosition =
        logHourRange === 0
          ? 0
          : Math.log(observedHours / MIN_OBSERVED_HOURS) / logHourRange;

      return {
        left: hourPosition * 100,
        bottom: 8 + ((point.level - minLevel) / levelRange) * 80,
      };
    },
    [levelRange, logHourRange, minLevel],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      let nearest:
        | {
            point: HistoricalPoint;
            playerName: string;
            playerIndex: number;
            left: number;
            bottom: number;
          }
        | undefined;
      let nearestDistance = 32;

      for (const playerSeries of series) {
        for (const point of playerSeries.points) {
          const position = positionFor(point);
          const pointX = (position.left / 100) * bounds.width;
          const pointY = bounds.height - (position.bottom / 100) * bounds.height;
          const distance = Math.hypot(pointerX - pointX, pointerY - pointY);

          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = {
              point,
              playerName: playerSeries.name,
              playerIndex: playerSeries.index,
              ...position,
            };
          }
        }
      }

      setHoveredPoint(nearest ?? null);
    },
    [positionFor, series],
  );

  useEffect(() => {
    const plot = plotRef.current;
    const canvas = canvasRef.current;
    if (!plot || !canvas) return;

    const draw = () => {
      const width = Math.max(1, plot.clientWidth);
      const height = Math.max(1, plot.clientHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";

      for (const playerSeries of series) {
        if (playerSeries.points.length < 2) continue;
        context.beginPath();
        playerSeries.points.forEach((point, index) => {
          const position = positionFor(point);
          const x = (position.left / 100) * width;
          const y = height - (position.bottom / 100) * height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.strokeStyle = `hsl(${165 + playerSeries.index * 43} 72% 61%)`;
        context.lineWidth = 2;
        context.globalAlpha = 0.86;
        context.shadowColor = `hsl(${165 + playerSeries.index * 43} 72% 61% / 0.28)`;
        context.shadowBlur = 8;
        context.stroke();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(plot);
    return () => observer.disconnect();
  }, [positionFor, series]);

  return (
    <div className="progress-chart">
      <div className="progress-chart__y-label">Nível</div>
      <div
        className="plot"
        ref={plotRef}
        role="img"
        aria-label="Gráfico de linhas mostrando a progressão de nível por horas observadas em escala logarítmica"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredPoint(null)}
      >
        <div className="plot__grid" aria-hidden="true" />
        <canvas className="plot__lines" ref={canvasRef} aria-hidden="true" />
        {levelTicks.map((tick, index) => (
          <span
            className="plot__level-tick"
            key={`${tick}-${index}`}
            style={{ top: `${index * 50}%` }}
          >
            {tick}
          </span>
        ))}
        {series.flatMap((playerSeries) =>
          playerSeries.levelUps.map((point) => {
            const position = positionFor(point);
            return (
              <span
                className="level-up-marker"
                key={`level-up-${playerSeries.key}-${point.sampledAt}`}
                style={
                  {
                    left: `${position.left}%`,
                    bottom: `${position.bottom}%`,
                    "--point-index": playerSeries.index,
                  } as CSSProperties
                }
                aria-hidden="true"
              />
            );
          }),
        )}
        {hoveredPoint ? (
          <span
            className={`plot-tooltip${
              hoveredPoint.left < 24
                ? " plot-tooltip--left"
                : hoveredPoint.left > 76
                  ? " plot-tooltip--right"
                  : ""
            }`}
            style={
              {
                left: `${hoveredPoint.left}%`,
                bottom: `${hoveredPoint.bottom}%`,
                "--point-index": hoveredPoint.playerIndex,
              } as CSSProperties
            }
          >
            <strong>{hoveredPoint.playerName}</strong>
            <span>Nível {hoveredPoint.point.level}</span>
            <span>{formatHours(hoveredPoint.point.hoursPlayed)}</span>
            <span>{formatSampleDate(hoveredPoint.point.sampledAt)}</span>
          </span>
        ) : null}
      </div>
      <div className="progress-chart__x-axis" aria-hidden="true">
        {hourTicks.map((tick, index) => (
          <span key={`${tick}-${index}`}>{formatHours(tick)}</span>
        ))}
      </div>
      <div className="progress-chart__x-label">Tempo observado por jogador · escala logarítmica</div>
      <div className="chart-legend">
        {series.map((playerSeries) => (
          <span key={playerSeries.key}>
            <i
              style={{ "--point-index": playerSeries.index } as CSSProperties}
            />
            {playerSeries.name}
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
        progress: [],
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
          <span
            className={`collector-status${history?.collector?.stale ? " collector-status--bad" : ""}`}
            role="status"
            title={`Última amostra: ${formatSampleDate(history?.collector?.lastSampleAt ?? 0)}`}
          >
            <span className="health-dot" aria-hidden="true" />
            <span className="collector-status__text">
              {history?.collector?.stale
                ? "Coleta atrasada"
                : "Coleta histórica saudável"}
            </span>
          </span>
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
                  <span>Cada linha acompanha o nível ao longo do tempo</span>
                </div>
                <span className="sample-badge">
                  amostra / {history?.sampleIntervalMinutes ?? 5} min
                </span>
              </div>
              <ProgressChart
                players={historicalPlayers}
                points={history?.progress ?? []}
              />
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
                      <a className="player-link" href={`/players/${player.playerKey}`}><strong>{player.name}</strong></a>
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

      <section className="events-panel" aria-labelledby="events-title">
        <div className="section-heading"><div><span className="section-kicker">LINHA DO TEMPO</span><h2 id="events-title">Eventos recentes</h2></div><span className="history-timestamp">últimos 30 eventos</span></div>
        {(history?.events ?? []).length ? <ol className="event-list">{history?.events?.map((event) => <li key={`${event.playerKey}-${event.occurredAt}-${event.type}`}><time>{formatSampleDate(event.occurredAt)}</time><a className="player-link" href={`/players/${event.playerKey}`}>{event.name}</a><span>{formatEvent(event.type, event.level, event.previousLevel)}</span></li>)}</ol> : <p className="muted-copy">Os próximos eventos aparecerão após a coleta.</p>}
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
