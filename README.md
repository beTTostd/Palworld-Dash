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
- gráfico de linhas da evolução de nível por horas observadas e ranking de nível;
- perfis de jogador e uma linha do tempo de entradas, saídas e subidas de nível;
- saúde da coleta, incluindo a última amostra e alertas de atraso.

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
install -d -o 999 -g 987 -m 0775 data
docker compose --profile collector run --rm -T palworld-collector
```

O coletor é executado como o UID/GID `999:987` e o SQLite precisa criar os
arquivos de journal no diretório `data`. Se o diretório for criado pelo root
durante o deploy, corrija sua propriedade e permissões antes de habilitar o
cron:

```bash
chown 999:987 data
chmod 0775 data
chmod 0664 data/palworld.db
```

Instale o cron de cinco minutos na VPS:

```text
*/5 * * * * root cd /opt/palworld-dash && /usr/bin/install -d -o 999 -g 987 -m 0775 data && /usr/bin/flock -n /run/palworld-dash-collector.lock /usr/bin/docker compose --profile collector run --rm -T palworld-collector >> /var/log/palworld-dash-collector.log 2>&1
```

As horas são aproximadas a partir das presenças observadas a cada cinco
minutos e começam a contar apenas depois da instalação do coletor. As amostras
detalhadas são mantidas por 30 dias (`RAW_RETENTION_DAYS`); o painel preserva
um ponto agregado por dia para manter o histórico de longo prazo compacto.

### Timer recomendado (systemd)

Em servidores com systemd, prefira o timer incluído ao cron. Ele persiste
execuções perdidas durante reinicializações e deixa os logs disponíveis pelo
journal:

```bash
cp systemd/palworld-dash-collector.service /etc/systemd/system/
cp systemd/palworld-dash-collector.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now palworld-dash-collector.timer
systemctl list-timers palworld-dash-collector.timer
```

A saúde do coletor fica disponível em `/api/health`; uma coleta com mais de
10 minutos é marcada como atrasada.

## Segurança

- a aplicação implementa apenas endpoints `GET`;
- a senha administrativa é lida do arquivo do Palworld montado como somente leitura;
- o container roda com o mesmo UID/GID não-root do arquivo do Palworld, sem
  capabilities e com filesystem somente leitura;
- o coletor é o único escritor do SQLite; a dashboard monta o banco como
  somente leitura;
- nenhuma credencial é armazenada no repositório ou enviada ao frontend.
