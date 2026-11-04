# Publicação na VPS da Oracle Cloud

O site roda com Docker em três contêineres:

- **app:** aplicação Next.js no modo hospedado.
- **banco:** PostgreSQL 18.
- **caddy:** proxy com HTTPS automático.

Funciona tanto nas instâncias Ampere (ARM) quanto nas AMD do Always Free.

## 1. Liberar as portas 80 e 443 no console da Oracle

O firewall da rede da Oracle bloqueia tudo, menos SSH. No console:

1. **Networking → Virtual cloud networks →** abra a VCN da instância.
2. Abra a **sub-rede** da instância e, nela, a **Security List** (normalmente "Default Security List").
3. **Add Ingress Rules**, uma regra para cada porta:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: TCP
   - Destination Port Range: `80` (e outra regra com `443`)

O firewall do próprio sistema (iptables no Ubuntu, firewalld no Oracle Linux) é liberado
automaticamente pelo script de instalação.

## 2. Publicar a partir do Windows

Dê dois cliques em **`publicar.bat`** e informe:

- **Usuário e IP da VPS:** por exemplo, `ubuntu@150.230.10.20`. Nas imagens Oracle Linux, o usuário é `opc`.
- **Caminho da chave SSH privada:** o arquivo `.key` baixado ao criar a instância.

O script empacota o projeto, envia para a VPS por SSH e executa `deploy/instalar-no-servidor.sh`. Esse script:

1. instala o Docker, se necessário;
2. libera as portas 80 e 443 no firewall do sistema;
3. cria 2 GB de swap se a máquina tiver pouca memória, porque o build do Next.js precisa disso nas instâncias de 1 GB;
4. cria o `.env.producao` com uma senha aleatória para o banco;
5. sobe os contêineres.

Ao final, ele mostra o endereço do site. Sem domínio próprio, o endereço é
`https://<ip-com-hifens>.sslip.io` (por exemplo, `https://150-230-10-20.sslip.io`). O sslip.io
aponta esse nome para o IP, e o Caddy emite o certificado HTTPS sozinho.

O usuário, o IP e o caminho da chave ficam salvos em `deploy/servidor.local.txt`. Nas próximas
atualizações, basta dar dois cliques em `publicar.bat` e apertar Enter.

## Domínio próprio

Para usar um domínio próprio (por exemplo, `slowquery.seudominio.com`):

1. Crie um registro DNS do tipo A apontando para o IP da VPS.
2. Publique com o domínio:

```powershell
powershell -ExecutionPolicy Bypass -File publicar.ps1 -Dominio slowquery.seudominio.com
```

## Configurações

No servidor, o arquivo `~/slowquery-monitor/.env.producao` define:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `DOMINIO` | IP com sslip.io | Endereço do site |
| `SENHA_BANCO` | gerada | Senha do banco de dados |
| `MAX_UPLOAD_MB` | 1024 | Tamanho máximo do arquivo enviado (arquivos .gz são descompactados no recebimento) |
| `RETENCAO_ANALISE_HORAS` | 72 | Tempo até o relatório e as ocorrências serem apagados |

Depois de alterar, publique de novo ou, no servidor, rode
`docker compose -f docker-compose.producao.yml --env-file .env.producao up -d`.

## Comandos úteis no servidor

```bash
cd ~/slowquery-monitor
docker compose -f docker-compose.producao.yml --env-file .env.producao ps          # situação dos contêineres
docker compose -f docker-compose.producao.yml --env-file .env.producao logs -f app # registros da aplicação
docker compose -f docker-compose.producao.yml --env-file .env.producao restart app # reinicia a aplicação
```

## Privacidade

- **O arquivo enviado** é apagado assim que o processamento termina.
- **As ocorrências extraídas**, que incluem o texto das consultas, ficam no banco até expirar o prazo de retenção.
- **Cada relatório** só pode ser aberto por quem tiver o link, que contém um identificador aleatório (UUID).
- **As páginas gerais** (lista de todas as consultas e situação do coletor) ficam desativadas no modo hospedado.
