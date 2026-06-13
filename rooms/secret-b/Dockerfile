FROM ubuntu:22.04

# 設定 UTF-8 locale，避免 vim/less 等工具在容器內顯示中文（多位元組字元）
# 時因為預設 POSIX locale 把 'encoding' 退回 latin1 而出現亂碼
ENV LANG=C.utf8 LC_ALL=C.utf8

ENV DEBIAN_FRONTEND=noninteractive
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y \
    bash vim less curl wget docker.io \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1000 player && \
    usermod -aG docker player

# 故意在一個 layer 寫入 FLAG，再在下一個 layer 刪除（FLAG 仍存在於 layer 中！）
ARG FLAG_SEED=escape_docker_dev_seed
RUN SECRET=$(echo -n "${FLAG_SEED}-secret-b" | sha256sum | cut -c1-16) && \
    mkdir -p /tmp/ghost_layer && \
    echo "EscapeDocker{${SECRET}}" > /tmp/ghost_layer/deleted_secret.txt
RUN rm -rf /tmp/ghost_layer

COPY setup.sh /setup.sh
RUN chmod +x /setup.sh && /setup.sh

USER player
WORKDIR /home/player
CMD ["/bin/bash", "--login"]
