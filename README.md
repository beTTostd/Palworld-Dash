# Palworld Dash

Dashboard somente leitura para acompanhar o servidor dedicado **Manapal**.

## O que mostra

- servidor online ou offline;
- versão e descrição;
- jogadores conectados e limite;
- FPS, frame time e tempo ligado;
- dias do mundo e bases ativas;
- nome, conta, nível e ping dos jogadores;
- histórico aproximado de horas observadas por jogador;
- gráfico de linhas da evolução de nível por horas observadas e ranking de nível.

IPs, IDs e coordenadas recebidos da API do Palworld são descartados pelo
backend e nunca chegam ao navegador.

## Executar com Docker

O `docker-compose.yml` espera o arquivo padrão de configuração em:

```text
/opt/palworld/server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini
```

Suba a aplicação:

```bash
docker compose up -d --build
```

A dashboard ficará disponível na porta `3000`.

## Coleta histórica

O coletor grava snapshots seguros em `data/palworld.db`. Ele descarta IP,
coordenadas e IDs brutos; o identificador interno do jogador é armazenado
somente como SHA-256.

Execute uma primeira coleta:

```bash
docker compose --profile collector run --rm -T palworld-collector
```

Instale o cron de cinco minutos na VPS:

```text
*/5 * * * * root cd /opt/palworld-dash && /usr/bin/flock -n /run/palworld-dash-collector.lock /usr/bin/docker compose --profile collector run --rm -T palworld-collector >> /var/log/palworld-dash-collector.log 2>&1
```

As horas são aproximadas a partir das presenças observadas a cada cinco
minutos e começam a contar apenas depois da instalação do coletor.

## Segurança

- a aplicação implementa apenas endpoints `GET`;
- a senha administrativa é lida do arquivo do Palworld montado como somente leitura;
- o container roda com o mesmo UID/GID não-root do arquivo do Palworld, sem
  capabilities e com filesystem somente leitura;
- o coletor é o único escritor do SQLite; a dashboard monta o banco como
  somente leitura;
- nenhuma credencial é armazenada no repositório ou enviada ao frontend.
