FROM ubuntu:22.04

# 設定 UTF-8 locale，避免 vim/less 等工具在容器內顯示中文（多位元組字元）
# 時因為預設 POSIX locale 把 'encoding' 退回 latin1 而出現亂碼
ENV LANG=C.utf8 LC_ALL=C.utf8

ENV DEBIAN_FRONTEND=noninteractive
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y \
    bash vim less curl wget tree \
    file binutils xxd python3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1000 player

COPY setup.sh /setup.sh
RUN chmod +x /setup.sh && /setup.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER player
WORKDIR /home/player
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/bin/bash", "--login"]
