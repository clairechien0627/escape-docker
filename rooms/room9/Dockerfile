FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y \
    bash vim less curl wget \
    docker.io dnsutils iputils-ping netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1000 player && \
    usermod -aG docker player

COPY setup.sh /setup.sh
RUN chmod +x /setup.sh && /setup.sh

USER player
WORKDIR /home/player
CMD ["/bin/bash", "--login"]
