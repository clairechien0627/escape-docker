FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y \
    bash vim less sudo curl wget \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1000 player

COPY setup.sh /setup.sh
COPY scripts/ /scripts/
RUN chmod +x /setup.sh /scripts/*.sh && /setup.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /home/player
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/bin/bash", "--login"]
