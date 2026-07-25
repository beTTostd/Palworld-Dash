# Palworld Dash

Dashboard somente leitura para acompanhar o servidor dedicado **Manapal**.

## O que mostra

- servidor online ou offline;
- versão e descrição;
- jogadores conectados e limite;
- FPS, frame time e tempo ligado;
- dias do mundo e bases ativas;
- nome, conta, nível e ping dos jogadores.

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

## Segurança

- a aplicação implementa apenas endpoints `GET`;
- a senha administrativa é lida do arquivo do Palworld montado como somente leitura;
- o container roda sem privilégios, sem capabilities e com filesystem somente leitura;
- nenhuma credencial é armazenada no repositório ou enviada ao frontend.
