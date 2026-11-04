# pgBadger 13.3, usado como referência na avaliação da ferramenta.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends perl libtext-csv-xs-perl libjson-xs-perl ca-certificates curl \
 && curl -fsSL https://github.com/darold/pgbadger/archive/refs/tags/v13.3.tar.gz | tar -xz -C /opt \
 && install -m 755 /opt/pgbadger-13.3/pgbadger /usr/local/bin/pgbadger \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY medir.sh /usr/local/bin/medir
RUN chmod +x /usr/local/bin/medir
ENTRYPOINT ["medir"]
