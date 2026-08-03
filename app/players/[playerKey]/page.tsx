"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Player = {
  name: string;
  accountName: string;
  level: number;
  hoursPlayed: number;
  firstSeen: number;
  lastSeen: number;
};

type PlayerEvent = {
  occurredAt: number;
  type: string;
  level: number;
  previousLevel?: number | null;
};

type SaveProfile = {
  parsedAt: number;
  saveTimestamp: number;
  attributes: {
    hp: number;
    shield: number;
    technologyPoints: number;
    ancientTechnologyPoints: number;
    unusedStatusPoints: number;
    allocations: Array<{ name: string; points: number }>;
  };
  collection: {
    total: number;
    uniqueSpecies: number;
    team: number;
    palbox: number;
    basesOrOther: number;
    alpha: number;
    lucky: number;
  };
  team: Array<{
    icon?: string | null;
    name: string;
    speciesId: string;
    level: number;
    gender: string;
    rank: number;
    lucky: boolean;
    alpha: boolean;
    favorite: boolean;
    hp: number;
    passives: string[];
    skills: string[];
  }>;
  equipment: Array<{
    category: string;
    slot: number;
    icon?: string | null;
    name: string;
    itemId: string;
    durability: number;
    remainingBullets: number;
  }>;
};

type Detail = {
  player?: Player;
  events?: PlayerEvent[];
  saveProfile?: SaveProfile | null;
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1_000));
}

function humanize(value: string) {
  return value
    .replace(/^EPalWazaID::/, "")
    .replace(/^BOSS_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

function normalizedRank(rank: number) {
  return Math.max(0, Math.min(4, rank - 1));
}

function rankStars(rank: number) {
  const filled = normalizedRank(rank);
  return "★".repeat(filled) + "☆".repeat(4 - filled);
}

function eventLabel(event: PlayerEvent) {
  if (event.type === "level_up") return `Subiu para o nível ${event.level}`;
  if (event.type === "joined") return "Entrou no servidor";
  return "Saiu do servidor";
}

export default function PlayerPage({ params }: { params: Promise<{ playerKey: string }> }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void params.then(({ playerKey }) => {
      fetch(`/api/players/${playerKey}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then(setDetail)
        .catch(() => setError(true));
    });
  }, [params]);

  const equipmentGroups = useMemo(() => {
    const groups = new Map<string, SaveProfile["equipment"]>();
    for (const item of detail?.saveProfile?.equipment ?? []) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups.entries()];
  }, [detail]);

  if (error) {
    return <main className="dashboard-shell"><p>Jogador não encontrado ou histórico indisponível.</p></main>;
  }
  if (!detail?.player) {
    return <main className="dashboard-shell"><p>Carregando perfil…</p></main>;
  }

  const player = detail.player;
  const save = detail.saveProfile;

  return (
    <main className="dashboard-shell player-profile">
      <Link className="player-link player-profile__back" href="/">← Voltar ao painel</Link>

      <section className="players-panel player-profile__hero">
        <div>
          <span className="section-kicker">PERFIL DO JOGADOR</span>
          <h1>{player.name}</h1>
          <p className="muted-copy">{player.accountName || "Conta Palworld"}</p>
        </div>
        {save ? (
          <span className="save-freshness">Save lido em {formatDate(save.saveTimestamp)}</span>
        ) : (
          <span className="save-freshness save-freshness--warning">Aguardando leitura do save</span>
        )}
      </section>

      <section className="stats-grid player-profile__summary" aria-label="Resumo do jogador">
        <article className="stat-card"><span className="stat-card__label">Nível</span><strong className="stat-card__value">{player.level}</strong></article>
        <article className="stat-card"><span className="stat-card__label">Horas observadas</span><strong className="stat-card__value">{player.hoursPlayed.toLocaleString("pt-BR")} h</strong></article>
        <article className="stat-card"><span className="stat-card__label">Pals possuídos</span><strong className="stat-card__value">{save?.collection.total ?? "—"}</strong></article>
        <article className="stat-card"><span className="stat-card__label">Espécies únicas</span><strong className="stat-card__value">{save?.collection.uniqueSpecies ?? "—"}</strong></article>
      </section>

      {save ? (
        <>
          <section className="profile-panel" aria-labelledby="attributes-title">
            <div className="section-heading"><div><span className="section-kicker">PERSONAGEM</span><h2 id="attributes-title">Atributos</h2></div></div>
            <div className="profile-metric-grid">
              <article><span>Vida atual</span><strong>{save.attributes.hp.toLocaleString("pt-BR")}</strong></article>
              <article><span>Escudo</span><strong>{save.attributes.shield.toLocaleString("pt-BR")}</strong></article>
              <article><span>Pontos de tecnologia</span><strong>{save.attributes.technologyPoints}</strong></article>
              <article><span>Tecnologia antiga</span><strong>{save.attributes.ancientTechnologyPoints}</strong></article>
              <article><span>Pontos disponíveis</span><strong>{save.attributes.unusedStatusPoints}</strong></article>
            </div>
            <div className="allocation-list" aria-label="Distribuição de pontos">
              {save.attributes.allocations.map((allocation) => <span key={allocation.name}>{allocation.name} <strong>+{allocation.points}</strong></span>)}
            </div>
          </section>

          <section className="profile-panel" aria-labelledby="collection-title">
            <div className="section-heading"><div><span className="section-kicker">COLEÇÃO</span><h2 id="collection-title">Resumo dos Pals</h2></div></div>
            <div className="profile-metric-grid profile-metric-grid--collection">
              <article><span>No time</span><strong>{save.collection.team}</strong></article>
              <article><span>No Palbox</span><strong>{save.collection.palbox}</strong></article>
              <article><span>Bases / outros</span><strong>{save.collection.basesOrOther}</strong></article>
              <article><span>Alpha</span><strong>{save.collection.alpha}</strong></article>
              <article><span>Lucky</span><strong>{save.collection.lucky}</strong></article>
            </div>
          </section>

          <section className="profile-panel" aria-labelledby="team-title">
            <div className="section-heading"><div><span className="section-kicker">EQUIPE ATUAL</span><h2 id="team-title">Time de Pals</h2></div><span className="history-timestamp">{save.team.length}/5 slots</span></div>
            <div className="pal-team-grid">
              {save.team.map((pal, index) => (
                <article className="pal-card" key={`${pal.speciesId}-${index}`}>
                  <div className="pal-card__head">
                    <div className="pal-card__portrait">
                      {pal.icon ? (
                        <Image unoptimized src={pal.icon} alt={`Retrato de ${pal.name}`} width={96} height={96} />
                      ) : (
                        <span className="profile-image-fallback">PAL</span>
                      )}
                      <span className="pal-card__index">{index + 1}</span>
                    </div>
                    <div className="pal-card__identity">
                      <div className="pal-card__name-line">
                        {pal.alpha ? <span className="pal-card__alpha-icon" aria-label="Pal Alpha" title="Pal Alpha">α</span> : null}
                        <strong>{pal.name}</strong>
                        <span className="pal-card__rank" aria-label={`${normalizedRank(pal.rank)} de 4 estrelas`} title={`Rank ${normalizedRank(pal.rank)} de 4`}>
                          {rankStars(pal.rank)}
                        </span>
                      </div>
                      <small>{humanize(pal.speciesId)}</small>
                    </div>
                  </div>
                  <div className="pal-card__badges">
                    <span>Nível {pal.level}</span><span>{pal.gender}</span>
                    {pal.lucky ? <span className="pal-badge pal-badge--lucky">Lucky</span> : null}
                    {pal.favorite ? <span className="pal-badge">★ Favorito</span> : null}
                  </div>
                  <div className="pal-card__stat"><span>HP</span><strong>{pal.hp.toLocaleString("pt-BR")}</strong></div>
                  <div className="pal-card__skills"><small>Passivas</small>{pal.passives.length ? pal.passives.map((skill) => <span key={skill}>{humanize(skill)}</span>) : <span>—</span>}</div>
                  <div className="pal-card__skills"><small>Habilidades</small>{pal.skills.map((skill) => <span key={skill}>{humanize(skill)}</span>)}</div>
                </article>
              ))}
            </div>
          </section>

          <section className="profile-panel" aria-labelledby="equipment-title">
            <div className="section-heading"><div><span className="section-kicker">LOADOUT</span><h2 id="equipment-title">Itens equipados</h2></div></div>
            {equipmentGroups.map(([category, items]) => (
              <div className="equipment-group" key={category}>
                <h3>{category}</h3>
                <div className="equipment-grid">
                  {items.map((item) => (
                    <article className="equipment-card" key={`${category}-${item.slot}`}>
                      <div className="equipment-card__image">
                        {item.icon ? (
                          <Image unoptimized src={item.icon} alt={item.name} width={64} height={64} />
                        ) : (
                          <span className="profile-image-fallback">ITEM</span>
                        )}
                      </div>
                      <div className="equipment-card__content">
                        <span className="equipment-slot">Slot {item.slot + 1}</span>
                        <strong>{item.name}</strong>
                        <small>{item.durability > 0 ? `Durabilidade ${item.durability.toLocaleString("pt-BR")}` : "Equipado"}{item.remainingBullets > 0 ? ` · ${item.remainingBullets} munições` : ""}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      ) : (
        <section className="profile-panel"><p className="muted-copy">Os detalhes de Pals e equipamentos aparecerão após a próxima leitura segura do save.</p></section>
      )}

      <section className="profile-panel" aria-labelledby="events-title">
        <div className="section-heading"><div><span className="section-kicker">ATIVIDADE</span><h2 id="events-title">Eventos recentes</h2></div></div>
        <ol className="event-list">
          {detail.events?.slice(0, 12).map((event) => <li key={`${event.occurredAt}-${event.type}`}><time>{formatDate(event.occurredAt)}</time><span>{eventLabel(event)}</span></li>)}
        </ol>
      </section>
    </main>
  );
}
