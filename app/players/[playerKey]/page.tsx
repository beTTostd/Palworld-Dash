"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Detail = { player?: { name: string; accountName: string; level: number; hoursPlayed: number; firstSeen: number; lastSeen: number }; events?: Array<{ occurredAt: number; type: string; level: number; previousLevel?: number | null }> };
export default function PlayerPage({ params }: { params: Promise<{ playerKey: string }> }) {
 const [detail,setDetail]=useState<Detail|null>(null); const [error,setError]=useState(false);
 useEffect(()=>{ void params.then(({playerKey})=>{fetch(`/api/players/${playerKey}`,{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(setDetail).catch(()=>setError(true));});},[params]);
 if(error) return <main className="dashboard-shell"><p>Jogador não encontrado ou histórico indisponível.</p></main>;
 if(!detail?.player) return <main className="dashboard-shell"><p>Carregando perfil…</p></main>;
 const p=detail.player; return <main className="dashboard-shell"><Link className="player-link" href="/">← Painel</Link><section className="players-panel"><span className="section-kicker">PERFIL DO JOGADOR</span><h1>{p.name}</h1><p className="muted-copy">{p.accountName || "Conta Palworld"}</p><div className="stats-grid"><article className="stat-card"><span className="stat-card__label">Nível</span><strong className="stat-card__value">{p.level}</strong></article><article className="stat-card"><span className="stat-card__label">Horas observadas</span><strong className="stat-card__value">{p.hoursPlayed} h</strong></article></div><h2>Eventos recentes</h2><ol className="event-list">{detail.events?.map(e=><li key={`${e.occurredAt}-${e.type}`}><time>{new Date(e.occurredAt*1000).toLocaleString("pt-BR")}</time><span>{e.type === "level_up" ? `Subiu para nível ${e.level}` : e.type === "joined" ? "Entrou no servidor" : "Saiu do servidor"}</span></li>)}</ol></section></main>;
}
